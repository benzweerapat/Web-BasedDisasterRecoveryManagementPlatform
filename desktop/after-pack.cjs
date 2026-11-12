'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
// extraResources' default matcher excludes node_modules. Explicitly copy the
// independently installed production backend tree before signing/archiving.
module.exports = async context => {
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const source = path.join(context.packager.projectDir,'backend','node_modules');
  const backend = path.join(resources,'server','backend');
  if (!fs.existsSync(source)) throw Error('Install backend production dependencies before packaging');
  fs.cpSync(source,path.join(backend,'node_modules'),{recursive:true,dereference:false,filter:filename=>!filename.split(path.sep).includes('.bin')});
  const requireFromBundle = createRequire(path.join(backend,'package.json'));
  for (const name of ['express','express-session','axios','zod','xml2js']) {
    const resolved = requireFromBundle.resolve(name);
    if (!resolved.startsWith(path.join(backend,'node_modules')+path.sep)) throw Error('Backend dependency escaped the packaged application');
  }
};
