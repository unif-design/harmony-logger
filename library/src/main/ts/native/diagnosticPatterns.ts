import { STACK_SOURCE_NAME_PATTERN as sourceNames, USER_PATH_PATTERN as sourcePaths } from '../generated/normalization/sourceConstants';

export const STACK_SOURCE_NAME_PATTERN = new RegExp(`(?:${sourceNames.source})|^[a-z\\d_$.-]+\\.ets$`, sourceNames.flags);
export const USER_PATH_PATTERN = new RegExp(`(?:${sourcePaths.source})|\\/(?:data\\/(?:storage|app|service)|storage\\/(?:Users|media))\\/[^\\s"'<>)]*`, sourcePaths.flags);
