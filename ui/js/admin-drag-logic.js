/* Pure rules for admin-list drag and drop. Only apps may live inside a folder;
   widgets and folders always stay at the top level. Kept separate from the DOM
   handlers in admin.js so the routing can be unit-tested. */

export function canJoinFolder(type) {
  return type === 'app';
}

/* Decide what a drop should do given the dragged item's type and the target.
   Returns 'into-folder' only when an app is dropped onto a folder row or onto a
   row inside a folder; otherwise 'reorder' (top-level move). */
export function dropTargetKind({ srcType, targetIsFolder = false, indent = false }) {
  if (canJoinFolder(srcType) && (targetIsFolder || indent)) return 'into-folder';
  return 'reorder';
}

/* Apply a drag move to `items` in place, returning true when it changed. `d`
   describes the dragged row and the row it was dropped on:
     srcId          dragged item id
     srcFolderId    folder the dragged row lived in, or null for a top-level row
     targetId       id of the row dropped on
     targetFolderId folder of the target row when the target is a folder child
     targetIsFolder the target row is a folder
     indent         the target row is a folder child
     childIdx       index of the target child within its folder (when indent)
     dropAbove      insert before rather than after the target (reorder only)
   The child object stays in `items` throughout; folders reference it by id, so
   leaving a folder is removing that id, and joining one is adding it back. */
export function applyDrop(items, d) {
  const src = items.find(i => i.id === d.srcId);
  if (!src || d.srcId === d.targetId) return false;

  if (d.srcFolderId) {
    const sf = items.find(i => i.id === d.srcFolderId);
    if (sf) sf.children = (sf.children || []).filter(id => id !== src.id);
  } else {
    const si = items.indexOf(src);
    if (si >= 0) items.splice(si, 1);
  }

  const kind = dropTargetKind({ srcType: src.type, targetIsFolder: !!d.targetIsFolder, indent: !!d.indent });

  if (kind === 'into-folder' && d.indent) {
    const tf = items.find(i => i.id === d.targetFolderId);
    if (!tf) { items.push(src); return true; }
    tf.children = (tf.children || []).filter(id => id !== src.id);
    if (!items.find(i => i.id === src.id)) items.push(src);
    tf.children.splice(d.childIdx, 0, src.id);
  } else if (kind === 'into-folder') {
    if (!items.find(i => i.id === src.id)) items.push(src);
    const tf = items.find(i => i.id === d.targetId);
    if (tf) { tf.children = (tf.children || []).filter(id => id !== src.id); tf.children.push(src.id); }
  } else {
    items.filter(f => f.type === 'folder').forEach(f => {
      f.children = (f.children || []).filter(id => id !== src.id);
    });
    if (!items.find(i => i.id === src.id)) items.push(src);
    const si2 = items.indexOf(src);
    if (si2 >= 0) items.splice(si2, 1);
    const anchor = d.indent ? items.find(i => i.id === d.targetFolderId) : items.find(i => i.id === d.targetId);
    let ti = items.indexOf(anchor);
    if (ti < 0) ti = items.length;
    items.splice(Math.max(0, d.dropAbove ? ti : ti + 1), 0, src);
  }
  return true;
}
