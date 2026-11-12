const operationMessages = {
 TRANSPORT_ERROR: 'Unable to reach the VMware service.',
 TIMEOUT: 'The VMware service did not respond in time. Check operation progress before retrying.',
 UPSTREAM_AUTH_FAILED: 'VMware authentication failed after refreshing the session.',
 UPSTREAM_FORBIDDEN: 'VMware denied this operation. Check the upstream account permissions.',
 VALIDATION_ERROR: 'The request contains invalid values.',
 INVALID_STATE: 'The current VMware state does not allow this operation.',
 WRITE_CONFLICT: 'Another operation is in progress or this request conflicts with a previous submission.',
 SRM_OPERATION_FAILED: 'Site Recovery Manager could not complete this operation.',
 VMWARE_OPERATION_FAILED: 'VMware could not complete this operation.',
 DATABASE_ERROR: 'Application data is temporarily unavailable.',
 CONTRACT_ERROR: 'The service returned an unsupported response. Success could not be verified.',
 UNKNOWN_UPSTREAM_ERROR: 'The VMware response could not be verified. Check progress before retrying.'
};
export function classifyApiError(err, endpoint) {
  const status=err.response?.status, upstream=err.response?.data?.error, code=upstream?.code;
  let type, safeMessage;
  if (!status && (err.request || ['ERR_NETWORK','ECONNABORTED','ETIMEDOUT'].includes(err.code))) {type='NETWORK_ERROR';safeMessage='Unable to connect to the application server.';}
  else if(!status){type='CLIENT_ERROR';safeMessage='The application could not process this request.';}
  else if(status===401){type='AUTH_REQUIRED';safeMessage='Your session has expired. Please sign in again.';}
  else if(status===403){type='FORBIDDEN';safeMessage='You do not have permission to perform this action.';}
  else if(operationMessages[upstream?.type] || operationMessages[code]){type=operationMessages[upstream?.type]?upstream.type:code;safeMessage=operationMessages[type];}
  else if(/SRM/.test(code||'')){type='SRM_UNAVAILABLE';safeMessage='Site Recovery Manager could not complete the request.';}
  else if(/VMWARE|VR_|UPSTREAM/.test(code||'')){type='VMWARE_UNAVAILABLE';safeMessage='VMware could not complete the request.';}
  else if(/DATABASE/.test(code||'')){type='DATABASE_ERROR';safeMessage='Application data is temporarily unavailable.';}
  else if(status===404){type='NOT_FOUND_ERROR';safeMessage='The requested API was not found.';}
  else if(status===409){type='CONFLICT';safeMessage='The current state conflicts with this request.';}
  else if(status>=500){type='BACKEND_ERROR';safeMessage='The application server could not complete the request.';}
  else{type='VALIDATION_ERROR';safeMessage='The request could not be accepted.';}
  return {type,code:code||type,httpStatus:status,endpoint,requestId:upstream?.requestId||err.response?.data?.requestId,safeMessage};
}
