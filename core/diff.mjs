function key(element) {
  return element.locator?.selector || `${element.tag}|${element.role}|${element.name}|${element.parentText}`;
}

export function diffMaps(previous, current) {
  const oldByKey = new Map((previous?.elements || []).map(element => [key(element), element]));
  const newByKey = new Map((current?.elements || []).map(element => [key(element), element]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, element] of newByKey) {
    const old = oldByKey.get(id);
    if (!old) added.push(element);
    else if (JSON.stringify({ text: old.text, rect: old.rect, visible: old.visible, disabled: old.disabled }) !==
             JSON.stringify({ text: element.text, rect: element.rect, visible: element.visible, disabled: element.disabled })) {
      changed.push({ before: old, after: element });
    }
  }
  for (const [id, element] of oldByKey) {
    if (!newByKey.has(id)) removed.push(element);
  }
  return { added, removed, changed };
}
