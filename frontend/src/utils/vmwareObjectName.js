export const VMWARE_OBJECT_NAME_MAX_LENGTH = 80;
export const VMWARE_OBJECT_NAME_PATTERN = /^[\p{L}\p{M}\p{N} _.-]+$/u;

export function validateVmwareObjectName(value) {
  const name = String(value ?? '').trim();
  if (!name) return 'Name is required.';
  if (name.length > VMWARE_OBJECT_NAME_MAX_LENGTH) return `Name must not exceed ${VMWARE_OBJECT_NAME_MAX_LENGTH} characters.`;
  if (!VMWARE_OBJECT_NAME_PATTERN.test(name)) return 'Use letters, numbers, spaces, periods, underscores, or hyphens only.';
  return null;
}

export function isValidVmwareObjectName(value) {
  return validateVmwareObjectName(value) === null;
}
