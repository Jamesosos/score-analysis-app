function fileKey(file) {
  return [file.year, file.term, file.grade, file.className].map((v) => String(v || '').trim()).join('|');
}

function normalizedValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${value}`;
  const text = String(value).trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? `number:${Number(text)}` : `text:${text}`;
}

function displayValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '（空白）';
  return String(value);
}

function studentsForFile(dataset, file) {
  const exact = dataset.students.filter((student) => student.filePath === file.path);
  if (exact.length || !file.year) return exact;
  return dataset.students.filter((student) =>
    student.year === file.year
      && student.term === file.term
      && student.grade === file.grade
      && student.className === file.className);
}

function studentIdentity(student) {
  return String(student.id || student.name || '').trim();
}

function subjectName(student, key) {
  return student.subjectLabels?.[key] || key.replace(/^@subject:/, '');
}

function studentFields(student, columns) {
  const fields = new Map();
  fields.set('學號', student.id);
  fields.set('姓名', student.name);

  for (const [key, value] of Object.entries(student.scores || {})) {
    fields.set(`科目：${subjectName(student, key)}`, value);
  }
  for (const [key, value] of Object.entries(student.info || {})) fields.set(key, value);
  for (const [key, value] of Object.entries(student.derived || {})) fields.set(key, value);

  const knownHeaders = new Set((columns || []).map((column) => column.sourceHeader || column.header));
  for (const [key, value] of Object.entries(student.cells || {})) {
    if (!knownHeaders.has(key) && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

function compareStudents(previous, incoming, oldColumns, newColumns) {
  const oldById = new Map(previous.map((student) => [studentIdentity(student), student]));
  const newById = new Map(incoming.map((student) => [studentIdentity(student), student]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, student] of newById) {
    const oldStudent = oldById.get(id);
    if (!oldStudent) {
      added.push({ identity: student.name || id });
      continue;
    }
    const oldFields = studentFields(oldStudent, oldColumns);
    const newFields = studentFields(student, newColumns);
    const fieldChanges = [];
    for (const field of new Set([...oldFields.keys(), ...newFields.keys()])) {
      const oldValue = oldFields.get(field);
      const newValue = newFields.get(field);
      if (normalizedValue(oldValue) !== normalizedValue(newValue)) {
        fieldChanges.push({
          field,
          oldValue: displayValue(oldValue),
          newValue: displayValue(newValue),
        });
      }
    }
    if (fieldChanges.length) {
      changed.push({ identity: student.name || id, fields: fieldChanges });
    }
  }
  for (const [id, student] of oldById) {
    if (!newById.has(id)) removed.push({ identity: student.name || id });
  }
  return { added, removed, changed };
}

function matchFiles(previousFiles, incomingFiles) {
  const unmatched = new Set(previousFiles.map((_, index) => index));
  const pairs = [];
  const added = [];

  for (const incoming of incomingFiles) {
    const exactIndex = [...unmatched].find((index) => previousFiles[index].path === incoming.path);
    const matchingIndex = exactIndex ?? [...unmatched].find((index) =>
      fileKey(previousFiles[index]) === fileKey(incoming));
    if (matchingIndex === undefined) {
      added.push(incoming);
      continue;
    }
    unmatched.delete(matchingIndex);
    pairs.push({ previous: previousFiles[matchingIndex], incoming });
  }

  return {
    pairs,
    added,
    removed: [...unmatched].map((index) => previousFiles[index]),
  };
}

/** Compare parsed datasets without changing either input. */
export function compareDatasets(previous, incoming) {
  const oldFiles = previous?.files || [];
  const newFiles = incoming?.files || [];
  const matched = matchFiles(oldFiles, newFiles);
  const changed = [];
  let unchangedCount = 0;

  for (const pair of matched.pairs) {
    const students = compareStudents(
      studentsForFile(previous, pair.previous),
      studentsForFile(incoming, pair.incoming),
      previous.columns,
      incoming.columns,
    );
    const oldSubjects = new Set(pair.previous.subjects || []);
    const newSubjects = new Set(pair.incoming.subjects || []);
    const addedSubjects = [...newSubjects].filter((subject) => !oldSubjects.has(subject));
    const removedSubjects = [...oldSubjects].filter((subject) => !newSubjects.has(subject));
    const fileSizeChanged = Number.isFinite(pair.previous.size)
      && Number.isFinite(pair.incoming.size)
      && pair.previous.size !== pair.incoming.size;
    const metadataLabels = { year: '學年', term: '學段', grade: '年級', className: '班級' };
    const metadataChanges = Object.entries(metadataLabels)
      .filter(([key]) => pair.previous[key] !== pair.incoming[key])
      .map(([key, field]) => ({
        field,
        oldValue: displayValue(pair.previous[key]),
        newValue: displayValue(pair.incoming[key]),
      }));
    const hasChanges = students.added.length || students.removed.length || students.changed.length
      || pair.previous.ok !== pair.incoming.ok
      || addedSubjects.length || removedSubjects.length || fileSizeChanged
      || metadataChanges.length;
    if (hasChanges) {
      changed.push({
        file: pair.incoming.path,
        ...students,
        addedSubjects,
        removedSubjects,
        metadataChanges,
        oldSize: pair.previous.size,
        newSize: pair.incoming.size,
      });
    } else {
      unchangedCount++;
    }
  }

  return {
    added: matched.added.map((file) => ({
      file: file.path,
      students: studentsForFile(incoming, file).length,
    })),
    removed: matched.removed.map((file) => ({
      file: file.path,
      students: studentsForFile(previous, file).length,
    })),
    changed,
    unchangedCount,
  };
}
