import { createContext, useContext } from 'react';

export type OrgWorkspaceNavFn = (
  view: string,
  extraParams?: Record<string, string | null | undefined>,
) => void;

/** Set by `OrganizationWorkspace` so deep views can switch sidebar views with optional params without prop drilling. */
export const OrgWorkspaceNavContext = createContext<null | OrgWorkspaceNavFn>(null);

export function useOrgWorkspaceNav() {
  return useContext(OrgWorkspaceNavContext);
}

