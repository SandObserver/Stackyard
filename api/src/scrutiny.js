/* Shape a Scrutiny `/api/summary` response into the device list the widget
   needs. Kept pure (no network) so it can be shared by the query-URL and
   config-URL routes and unit-tested directly. */
function mapScrutinyDevices(summary) {
  return Object.values(summary || {})
    .filter(e => e && e.device?.smart_support?.available === true && e.smart)
    .map(e => ({
      device_id:   e.device.device_id,
      model_name:  e.device.model_name || e.device.device_serial_id || e.device.device_name,
      device_name: e.device.device_name,
      capacity:    e.device.capacity,
    }));
}

module.exports = { mapScrutinyDevices };
