/**
 * SRM Inventory Mapping SOAP Adapter
 * 
 * Read-only SOAP SDK fallback for inventory mappings that return HTTP 401 via REST.
 * 
 * WSDL Source: Live SRM 9.0.2 appliance at /drserver/srm.wsdl
 * Target Namespace: urn:srm0
 * SOAPAction: urn:srm0/14.0
 * Runtime Endpoint: https://<SRM_HOST>/drserver/vcdr/extapi/sdk
 * 
 * Confirmed read-only operations:
 *   - RetrieveContent (ServiceInstance) -> SrmServiceInstanceContent
 *   - SrmLogin (srmApi, username, password)
 *   - SrmLogout (srmApi)
 *   - GetNetworkMappings (inventoryMapping)
 *   - GetFolderMappings (inventoryMapping)
 *   - GetResourcePoolMappings (inventoryMapping)
 *   - GetTestNetworkMappings (inventoryMapping)
 * 
 * NOT implemented (read-only constraint):
 *   - AddNetworkMapping, RemoveNetworkMapping
 *   - AddFolderMapping, RemoveFolderMapping
 *   - AddResourcePoolMapping, RemoveResourcePoolMapping
 *   - AddTestNetworkMapping, RemoveTestNetworkMapping
 *   - Any recovery, cleanup, failover, or reprotect operations
 * 
 * No GetStoragePolicyMappings method exists in the WSDL.
 */

const vmwareHttpService =
  require(
    '../../services/vmware-http.service'
  );

const SOAP_NS = 'urn:srm0';

const SOAP_ACTION =
  'urn:srm0/14.0';

const SOAP_ENDPOINT_PATH =
  '/drserver/vcdr/extapi/sdk';

const SOAP_MAPPING_OPERATIONS =
  Object.freeze({
    NETWORK:
      'GetNetworkMappings',

    FOLDER:
      'GetFolderMappings',

    RESOURCE:
      'GetResourcePoolMappings',

    TEST_NETWORK:
      'GetTestNetworkMappings'
  });

// ServiceInstance MoRef is always 'SrmServiceInstance' with type 'SrmServiceInstance'
const SERVICE_INSTANCE_MOREF = {
  type: 'SrmServiceInstance',
  value: 'SrmServiceInstance'
};

class SrmMappingSoapAdapter {
  getMappingCapabilities() {
    return {
      NETWORK: {
        supported: true,

        operation:
          SOAP_MAPPING_OPERATIONS
            .NETWORK
      },

      FOLDER: {
        supported: true,

        operation:
          SOAP_MAPPING_OPERATIONS
            .FOLDER
      },

      RESOURCE: {
        supported: true,

        operation:
          SOAP_MAPPING_OPERATIONS
            .RESOURCE
      },

      TEST_NETWORK: {
        supported: true,

        operation:
          SOAP_MAPPING_OPERATIONS
            .TEST_NETWORK
      },

      STORAGE_POLICY: {
        supported: false,
        operation: null
      }
    };
  }

  supportsMappingType(mappingType) {
    return (
      this.getMappingCapabilities()[
        mappingType
      ]?.supported === true
    );
  }

  /**
   * Build a SOAP envelope with the given body XML.
   */
  _buildEnvelope(bodyXml) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:srm0="${SOAP_NS}">
  <soapenv:Body>
    ${bodyXml}
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  /**
   * Build a ManagedObjectReference XML element.
   */
  _buildMoRef(
    elementName,
    moref
  ) {
    return `<${elementName} type="${moref.type}">${moref.value}</${elementName}>`;
  }
    /**
   * Send a SOAP request and return the raw XML response body.
   */
  async _soapCall(
    baseUrl,
    verifyTls,
    operationXml,
    cookie = null
  ) {
    const client =
      await vmwareHttpService
        .createClient(
          baseUrl,
          verifyTls
        );

    const headers = {
      'Content-Type':
        'text/xml; charset=utf-8',

      'SOAPAction':
        SOAP_ACTION
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const envelope =
      this._buildEnvelope(
        operationXml
      );

    const response =
      await client.post(
        SOAP_ENDPOINT_PATH,
        envelope,
        {
          headers,
          timeout: 30000
        }
      );

    if (
      response.status !== 200
    ) {
      const error =
        new Error(
          `SOAP_ERROR_STATUS_${response.status}`
        );

      error.code = 'SOAP_ERROR';
      error.status =
        response.status;

      throw error;
    }

    // Extract Set-Cookie for session management
    const setCookie =
      response.headers
        ?.['set-cookie'];

    const responseData =
      typeof response.data ===
        'string'
        ? response.data
        : JSON.stringify(
            response.data
          );

    // Check for SOAP Fault
    if (
      responseData.includes(
        '<soapenv:Fault>'
      ) ||

      responseData.includes(
        '<soap:Fault>'
      ) ||

      responseData.includes(
        ':Fault>'
      )
    ) {
      const faultMatch =
        responseData.match(
          /<faultstring>([^<]+)<\/faultstring>/
        );

      const error =
        new Error(
          `SOAP_FAULT: ${
            faultMatch
              ? faultMatch[1]
              : 'Unknown fault'
          }`
        );

      error.code = 'SOAP_FAULT';

      throw error;
    }

    return {
      body: responseData,

      cookie:
        setCookie
          ? setCookie[0]
              .split(';')[0]
          : cookie
    };
  }

  /**
   * Step 1: RetrieveContent — get SrmServiceInstanceContent
   * Returns: { srmApi, inventoryMapping, placeholderDatastoreManager, cookie }
   */
  async retrieveContent(
    baseUrl,
    verifyTls
  ) {
    const xml =
      `<RetrieveContent xmlns="${SOAP_NS}">
      ${this._buildMoRef(
        '_this',
        SERVICE_INSTANCE_MOREF
      )}
    </RetrieveContent>`;

    const {
      body,
      cookie
    } = await this._soapCall(
      baseUrl,
      verifyTls,
      xml
    );

    const parseRef = name => {
      const regex =
        new RegExp(
          `<(?:[\\w-]+:)?${name}[^>]*type="([^"]+)"[^>]*>([^<]+)</(?:[\\w-]+:)?${name}>`
        );

      const match =
        body.match(regex);

      if (match) {
        return {
          type: match[1],
          value: match[2]
        };
      }

      // Try alternate format
      const regex2 =
        new RegExp(
          `<${name}[^>]*>([^<]+)</${name}>[\\s\\S]*?<${name}[^>]*type="([^"]+)"`
        );

      return null;
    };

    const srmApi =
      parseRef('srmApi');

    const inventoryMapping =
      parseRef(
        'inventoryMapping'
      );

    const placeholderDatastoreManager =
      parseRef(
        'placeholderDatastoreManager'
      );

    if (!srmApi) {
      throw new Error(
        'SOAP_RETRIEVE_CONTENT_FAILED: srmApi not found in response'
      );
    }

    return {
      srmApi,
      inventoryMapping,
      placeholderDatastoreManager,
      cookie
    };
  }
    /**
   * Step 2: SrmLogin — authenticate to the SOAP SDK
   * The session is maintained via cookies (vmware_soap_session).
   */
  async srmLogin(
    baseUrl,
    verifyTls,
    srmApiRef,
    username,
    password,
    cookie
  ) {
    const xml =
      `<SrmLogin xmlns="${SOAP_NS}">
      ${this._buildMoRef(
        '_this',
        srmApiRef
      )}
      <username>${this._escapeXml(
        username
      )}</username>
      <password>${this._escapeXml(
        password
      )}</password>
    </SrmLogin>`;

    const result =
      await this._soapCall(
        baseUrl,
        verifyTls,
        xml,
        cookie
      );

    return result.cookie;
  }

  /**
   * Step 3: SrmLogout — clean up session
   */
  async srmLogout(
    baseUrl,
    verifyTls,
    srmApiRef,
    cookie
  ) {
    try {
      const xml =
        `<SrmLogout xmlns="${SOAP_NS}">
        ${this._buildMoRef(
          '_this',
          srmApiRef
        )}
      </SrmLogout>`;

      await this._soapCall(
        baseUrl,
        verifyTls,
        xml,
        cookie
      );
    } catch (e) {
      // Ignore logout errors
    }
  }

  /**
   * Get Network Mappings via SOAP SDK
   */
  async getNetworkMappings(
    baseUrl,
    verifyTls,
    inventoryMappingRef,
    cookie
  ) {
    return this._getMappings(
      baseUrl,
      verifyTls,
      'GetNetworkMappings',
      inventoryMappingRef,
      cookie
    );
  }

  /**
   * Get Folder Mappings via SOAP SDK
   */
  async getFolderMappings(
    baseUrl,
    verifyTls,
    inventoryMappingRef,
    cookie
  ) {
    return this._getMappings(
      baseUrl,
      verifyTls,
      'GetFolderMappings',
      inventoryMappingRef,
      cookie
    );
  }

  /**
   * Get Resource Pool Mappings via SOAP SDK
   */
  async getResourcePoolMappings(
    baseUrl,
    verifyTls,
    inventoryMappingRef,
    cookie
  ) {
    return this._getMappings(
      baseUrl,
      verifyTls,
      'GetResourcePoolMappings',
      inventoryMappingRef,
      cookie
    );
  }

  /**
   * Get Test Network Mappings via SOAP SDK
   */
  async getTestNetworkMappings(
    baseUrl,
    verifyTls,
    inventoryMappingRef,
    cookie
  ) {
    return this._getMappings(
      baseUrl,
      verifyTls,
      'GetTestNetworkMappings',
      inventoryMappingRef,
      cookie
    );
  }
    /**
   * Internal: call a Get*Mappings operation and parse the response.
   * All mapping operations take only _this (inventoryMapping MoRef).
   * Returns array of { primaryObject, secondaryObject } MoRefs.
   */
  async _getMappings(
    baseUrl,
    verifyTls,
    operationName,
    inventoryMappingRef,
    cookie
  ) {
    const xml =
      `<${operationName} xmlns="${SOAP_NS}">
      ${this._buildMoRef(
        '_this',
        inventoryMappingRef
      )}
    </${operationName}>`;

    const {
      body
    } = await this._soapCall(
      baseUrl,
      verifyTls,
      xml,
      cookie
    );

    // Parse returnval elements containing primaryObject and secondaryObject
    const results = [];

    const returnValRegex =
      /<(?:[\w-]+:)?returnval>([\s\S]*?)<\/(?:[\w-]+:)?returnval>/g;

    let match;

    while (
      (
        match =
          returnValRegex.exec(body)
      ) !== null
    ) {
      const block = match[1];

      const primary =
        this._parseMoRefFromBlock(
          block,
          'primaryObject'
        );

      const secondary =
        this._parseMoRefFromBlock(
          block,
          'secondaryObject'
        );

      const key =
        this._parseMoRefFromBlock(
          block,
          'key'
        );

      const value =
        this._parseMoRefFromBlock(
          block,
          'value'
        );

      results.push({
        primaryObject:
          primary || key,

        secondaryObject:
          secondary || value
      });
    }

    return results;
  }

  /**
   * Parse a ManagedObjectReference from an XML block.
   */
  _parseMoRefFromBlock(
    block,
    elementName
  ) {
    const regex =
      new RegExp(
        `<(?:[\\w-]+:)?${elementName}[^>]*type="([^"]+)"[^>]*>([^<]+)</(?:[\\w-]+:)?${elementName}>`
      );

    const match =
      block.match(regex);

    if (match) {
      return {
        type: match[1],
        value: match[2]
      };
    }

    return null;
  }

  /**
   * Escape XML special characters.
   */
  _escapeXml(str) {
    if (!str) return '';

    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
    /**
   * Full mapping fetch flow using SOAP SDK.
   * Returns: { networkMappings, folderMappings, resourcePoolMappings, testNetworkMappings }
   * 
   * Only fetches the specified mapping types (to avoid fetching types that REST already handled).
   */
  async fetchMappings(
    baseUrl,
    verifyTls,
    username,
    password,
    typesToFetch = [
      'NETWORK',
      'FOLDER',
      'RESOURCE'
    ]
  ) {
    let cookie = null;
    let srmApiRef = null;

    try {
      // Step 1: RetrieveContent
      const content =
        await this.retrieveContent(
          baseUrl,
          verifyTls
        );

      srmApiRef =
        content.srmApi;

      cookie =
        content.cookie;

      if (
        !content.inventoryMapping
      ) {
        throw new Error(
          'SOAP_NO_INVENTORY_MAPPING_REF: inventoryMapping not available in ServiceContent'
        );
      }

      // Step 2: Login
      cookie =
        await this.srmLogin(
          baseUrl,
          verifyTls,
          srmApiRef,
          username,
          password,
          cookie
        );

      // Step 3: Fetch requested mapping types
      const result = {};

      if (
        typesToFetch.includes(
          'NETWORK'
        )
      ) {
        try {
          result.networkMappings =
            await this.getNetworkMappings(
              baseUrl,
              verifyTls,
              content.inventoryMapping,
              cookie
            );
        } catch (e) {
          result.networkMappings =
            null;

          result.networkError =
            e.message;
        }
      }

      if (
        typesToFetch.includes(
          'FOLDER'
        )
      ) {
        try {
          result.folderMappings =
            await this.getFolderMappings(
              baseUrl,
              verifyTls,
              content.inventoryMapping,
              cookie
            );
        } catch (e) {
          result.folderMappings =
            null;

          result.folderError =
            e.message;
        }
      }

      if (
        typesToFetch.includes(
          'RESOURCE'
        )
      ) {
        try {
          result.resourcePoolMappings =
            await this.getResourcePoolMappings(
              baseUrl,
              verifyTls,
              content.inventoryMapping,
              cookie
            );
        } catch (e) {
          result.resourcePoolMappings =
            null;

          result.resourceError =
            e.message;
        }
      }

      if (
        typesToFetch.includes(
          'TEST_NETWORK'
        )
      ) {
        try {
          result.testNetworkMappings =
            await this.getTestNetworkMappings(
              baseUrl,
              verifyTls,
              content.inventoryMapping,
              cookie
            );
        } catch (e) {
          result.testNetworkMappings =
            null;

          result.testNetworkError =
            e.message;
        }
      }

      return result;
    } finally {
      // Step 4: Logout
      if (
        srmApiRef &&
        cookie
      ) {
        await this.srmLogout(
          baseUrl,
          verifyTls,
          srmApiRef,
          cookie
        );
      }
    }
  }
}

module.exports =
  new SrmMappingSoapAdapter();

module.exports.SOAP_MAPPING_OPERATIONS =
  SOAP_MAPPING_OPERATIONS;