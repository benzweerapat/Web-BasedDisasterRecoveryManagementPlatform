const xml2js = require('xml2js');

// จำกัดขนาด XML
const MAX_XML_SIZE_BYTES = 50 * 1024;

/**
 * Securely parses a SOAP XML response to extract the API Version.
 * Rejects DOCTYPE/ENTITY and oversized payloads to prevent XXE/Billion Laughs.
 * @param {string} xmlString The raw XML payload
 * @returns {Promise<string>} The extracted apiVersion
 */

//ฟังก์ชันหลัก
//รับค่า ข้อความ XML จาก vCenter
async function extractApiVersion(xmlString) {
  //ขั้นตอนตรวจสอบข้อมูล
  //ตรวจว่ามีข้อมูลและต้องเป็น String
  if (!xmlString || typeof xmlString !== 'string') {
    const err = new Error('Invalid XML payload provided.');
    err.code = 'XML_INVALID_PAYLOAD';
    throw err;
  }

  // 1. Size limit check
  if (Buffer.byteLength(xmlString, 'utf8') > MAX_XML_SIZE_BYTES) {
    const err = new Error('XML payload exceeds maximum allowed size.');
    err.code = 'XML_PAYLOAD_TOO_LARGE';
    throw err;
  }

  // 2. Reject DOCTYPE and ENTITY (case-insensitive)
  const upperXml = xmlString.toUpperCase();
  if (upperXml.includes('<!DOCTYPE') || upperXml.includes('<!ENTITY')) {
    const err = new Error('XML contains forbidden DOCTYPE or ENTITY definitions.');
    err.code = 'XML_FORBIDDEN_DIRECTIVES';
    throw err;
  }

  // 3. Configure xml2js Parser with strict mode and prefix stripping
  const parser = new xml2js.Parser({
    strict: true,
    explicitArray: false, // We only expect single values for apiVersion
    ignoreAttrs: true, // We don't care about attributes for this specific extraction
    tagNameProcessors: [xml2js.processors.stripPrefix] // Resolves elements by local name (ignoring soapenv:, urn:, etc.)
  });

  try {
    const result = await parser.parseStringPromise(xmlString);
    
    // 4. Safely traverse the parsed object by local names
    const envelope = result.Envelope;
    if (!envelope) throw new Error('Missing Envelope');
    
    const body = envelope.Body;
    if (!body) throw new Error('Missing Body');
    
    const response = body.RetrieveServiceContentResponse;
    if (!response) throw new Error('Missing RetrieveServiceContentResponse');
    
    const returnval = response.returnval;
    if (!returnval) throw new Error('Missing returnval');
    
    const about = returnval.about;
    if (!about) throw new Error('Missing about in returnval');
    
    const apiVersion = about.apiVersion;
    if (!apiVersion) throw new Error('Missing apiVersion in about');

    return typeof apiVersion === 'string' ? apiVersion : apiVersion._ || String(apiVersion);
  } catch (err) {
    const safeErr = new Error('Malformed or unexpected XML structure.');
    safeErr.code = 'XML_MALFORMED_STRUCTURE';
    safeErr.originalError = err.message;
    throw safeErr;
  }
}

module.exports = {
  extractApiVersion,
  MAX_XML_SIZE_BYTES
};
