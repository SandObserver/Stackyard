const net = require('node:net');
const os = require('node:os');

/** Whether `addr` is inside a subnet that a non-loopback interface of this
    machine sits on. Read on every call: a container can join a network while
    running.
    @param {string} addr @returns {boolean} */
function onLocalNetwork(addr) {
  const family = net.isIP(addr);
  if (!family) return false;
  const list = new net.BlockList();
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (!iface || iface.internal || !iface.cidr) continue;
    const [base, bits] = iface.cidr.split('/');
    list.addSubnet(base, Number(bits), iface.family === 'IPv6' ? 'ipv6' : 'ipv4');
  }
  return list.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

module.exports = { onLocalNetwork };
