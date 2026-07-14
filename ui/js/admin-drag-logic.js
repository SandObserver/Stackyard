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
