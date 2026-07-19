/* Pure parser for the icon upload's multipart/form-data body, split out from the
   icons route so the byte-scanning is unit-tested on its own. Buffer in, plain
   object out: { filename, data, fileParts }. filename is basename-stripped so a
   part naming a path cannot escape the icons dir. It returns the last file part
   seen plus a count of how many there were; the route rejects anything but one. */

const path = require('path');

function parseMultipartFile(buf, boundary) {
  const delim = Buffer.from('--' + boundary), CRLFCRLF = Buffer.from('\r\n\r\n');
  let filename = '', data = null, searchFrom = 0, fileParts = 0;
  while (true) {
    const delimPos = buf.indexOf(delim, searchFrom);
    if (delimPos === -1) break;
    const afterDelim = delimPos + delim.length;
    if (buf[afterDelim] === 0x2d && buf[afterDelim+1] === 0x2d) break;
    const headerStart = afterDelim + (buf[afterDelim] === 0x0d ? 2 : 0);
    const headerEnd   = buf.indexOf(CRLFCRLF, headerStart);
    if (headerEnd === -1) break;
    const headerStr  = buf.slice(headerStart, headerEnd).toString('latin1');
    const bodyStart  = headerEnd + 4;
    const nextDelim  = buf.indexOf(Buffer.from('\r\n--' + boundary), bodyStart);
    const bodyEnd    = nextDelim === -1 ? buf.length : nextDelim;
    const fnMatch    = headerStr.match(/filename="([^"]+)"/i);
    if (fnMatch) { fileParts++; filename = path.basename(fnMatch[1]); data = buf.slice(bodyStart, bodyEnd); }
    searchFrom = bodyEnd + 2;
  }
  return { filename, data, fileParts };
}

module.exports = { parseMultipartFile };
