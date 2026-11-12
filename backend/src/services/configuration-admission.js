'use strict';
let inFlight = 0;
function operationGuard(req,res,next) {
 if (!['POST','PUT','PATCH','DELETE'].includes(req.method) || !/^\/api\/(?:srm|vr|sync|connections)(?:\/|$)/.test(req.originalUrl.split('?')[0])) return next();
 if (/^\/api\/connections(?:\/\d+)?$/.test(req.originalUrl.split('?')[0])) return next();
 if(require('./sync-coordinator.service').hasKind('CONFIGURATION_CHANGE'))return res.status(409).json({message:'Server configuration is changing. Retry after it completes.'});
 inFlight++;
 let released=false;const release=()=>{if(!released){released=true;inFlight--;}};
 res.once('finish',release);res.once('close',release);next();
}
module.exports={operationGuard,hasInFlight:()=>inFlight>0};
