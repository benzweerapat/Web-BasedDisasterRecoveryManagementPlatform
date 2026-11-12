const vcenterAdapter = require('./vcenter.adapter');
const vrAdapter = require('./vr.adapter');
const srmAdapter = require('./srm.adapter');

class UnsupportedVmwareSystemError extends Error {
  constructor(message = 'This VMware product type is not supported') {
    super(message);
    this.name = 'UnsupportedVmwareSystemError';
  }
}
//เลือก adapter ที่ถูกต้องตาม systemType
function getVmwareAdapter(systemType) {
  switch (systemType) {
    case 'VCENTER':
      return vcenterAdapter;
    case 'VR':
      return vrAdapter;
    case 'SRM':
      return srmAdapter;
    default:
      throw new UnsupportedVmwareSystemError();
  }
}

module.exports = {
  getVmwareAdapter,
  UnsupportedVmwareSystemError
};
