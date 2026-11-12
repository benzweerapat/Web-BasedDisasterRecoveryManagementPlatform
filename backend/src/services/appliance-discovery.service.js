const net = require('net');

function parseUrlHost(value) {
  if (!value) {
    return {
      host: null,
      hostType: 'NOT_PROVIDED'
    };
  }

  try {
    const host =
      new URL(value).hostname;

    return {
      host,
      hostType: net.isIP(host)
        ? 'IP'
        : 'HOSTNAME'
    };
  } catch (_error) {
    return {
      host: null,
      hostType: 'INVALID_ENDPOINT'
    };
  }
}

function parseDiscoveryMetadata(value) {
  if (
    !value ||
    typeof value !== 'string' ||
    !value.trim().startsWith('{')
  ) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    return parsed &&
      typeof parsed === 'object'
      ? parsed
      : {};
  } catch (_error) {
    return {};
  }
}

function classifyAddress(value) {
  if (!value) {
    return {
      ip: null,
      hostname: null,
      availability:
        'NOT_PROVIDED_BY_API'
    };
  }

  if (net.isIP(value)) {
    return {
      ip: value,
      hostname: null,
      availability: 'AVAILABLE'
    };
  }

  return {
    ip: null,
    hostname: value,
    availability: 'AVAILABLE'
  };
}

function selectAuthoritativeAddress(
  endpointHost,
  metadata
) {
  const reported =
    metadata.applianceIp ||
    metadata.applianceAddress ||
    null;

  const reportedAddress =
    classifyAddress(reported);

  if (
    reportedAddress.availability ===
    'AVAILABLE'
  ) {
    return reportedAddress;
  }

  return classifyAddress(endpointHost);
}

function buildApplianceViewModel({
  connection,
  server,
  associatedVcenter,
  productType
}) {
  const endpoint =
    connection.api_base_url ||
    connection.base_url;

  const endpointInfo =
    parseUrlHost(endpoint);

  const metadata =
    parseDiscoveryMetadata(
      productType === 'SRM'
        ? server?.address
        : server?.safe_url
    );

  const authoritativeHost =
    metadata.apiEndpointHost ||
    endpointInfo.host;

  const authoritativeHostType =
    metadata.apiEndpointHostType ||
    (
      authoritativeHost
        ? (
            net.isIP(authoritativeHost)
              ? 'IP'
              : 'HOSTNAME'
          )
        : endpointInfo.hostType
    );

  const address =
    selectAuthoritativeAddress(
      authoritativeHost,
      metadata
    );

  const applianceName =
    server?.name ||
    connection.connection_name ||
    null;

  const version =
    server?.version || null;

  const build =
    server?.build ||
    server?.build_number ||
    null;

  return {
    connectionId: connection.id,

    pairingId:
      server?.pairing_id || null,

    siteName:
      connection.site || null,

    siteRole:
      connection.site || null,

    productType,

    applianceName,

    applianceNameAvailability:
      applianceName
        ? 'AVAILABLE'
        : 'NOT_PROVIDED_BY_API',

    apiEndpointHost:
      authoritativeHost || null,

    apiEndpointHostType:
      authoritativeHostType ||
      'NOT_PROVIDED',

    applianceIp:
      address.ip,

    applianceHostname:
      address.hostname,

    applianceAddressAvailability:
      address.availability,

    version,

    versionAvailability:
      version
        ? 'AVAILABLE'
        : 'NOT_PROVIDED_BY_API',

    build,

    associatedVcenterName:
      associatedVcenter
        ?.connection_name ||
      null,

    associatedVcenterHost:
      parseUrlHost(
        associatedVcenter?.base_url
      ).host,

    associatedVcenterStableId:
      server?.vc_guid ||
      server?.vcenter_external_id ||
      null,

    connectionStatus:
      connection.last_connection_status ||
      server?.server_status ||
      server?.status ||
      null,

    lastCollectedAt:
      server?.last_seen_at ||
      connection.last_verified_at ||
      connection.last_tested_at ||
      null
  };
}

module.exports = {
  parseUrlHost,
  parseDiscoveryMetadata,
  buildApplianceViewModel
};