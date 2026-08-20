/* Only apps may live inside a folder. Widgets and folders stay at the top
   level. */

export function canJoinFolder(type) {
  return type === 'app';
}

/* Share of a folder row's height at each edge that places the dragged row next
   to the folder instead of inside it. */
export const FOLDER_EDGE = 0.25;

/** Which part of a folder row the pointer is over.
    @param {number} y pointer position
    @param {{ top: number, height: number }} rect the row's box
    @returns {'above' | 'into' | 'below'} */
export function folderRowZone(y, rect) {
  const edge = rect.height * FOLDER_EDGE;
  if (y < rect.top + edge) return 'above';
  if (y > rect.top + rect.height - edge) return 'below';
  return 'into';
}

export function dropTargetKind({ srcType, targetIsFolder = false, indent = false }) {
  if (canJoinFolder(srcType) && (targetIsFolder || indent)) return 'into-folder';
  return 'reorder';
}

/* Applies a drag move in place. `d` describes the dragged row and the target:
     srcId, srcFolderId       the dragged row, and its folder or null
     targetId, targetFolderId the row dropped on, and its folder
     targetIsFolder, indent   the target is a folder, or sits inside one
     childIdx                 the target's index within its folder
     dropAbove                insert before rather than after (reorder only)
   The child object stays in `items` throughout. Folders reference it by id. */
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
    if (!tf) {
      items.push(src);
      return true;
    }
    tf.children = (tf.children || []).filter(id => id !== src.id);
    if (!items.find(i => i.id === src.id)) items.push(src);
    tf.children.splice(d.childIdx, 0, src.id);
  } else if (kind === 'into-folder') {
    if (!items.find(i => i.id === src.id)) items.push(src);
    const tf = items.find(i => i.id === d.targetId);
    if (tf) {
      tf.children = (tf.children || []).filter(id => id !== src.id);
      tf.children.push(src.id);
    }
  } else {
    items
      .filter(f => f.type === 'folder')
      .forEach(f => {
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
