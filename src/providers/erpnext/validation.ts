import { z } from "zod";

/**
 * Single hostname/FQDN label (lowercase), aligned with ERP `provisioning_api` site names.
 * @see https://datatracker.ietf.org/doc/html/rfc1035 — practical subset for bench site folder names.
 */
export const SITE_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const DOMAIN_REGEX = /^(?=.{3,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
export const USERNAME_REGEX = /^[a-z][a-z0-9_.-]{2,63}$/;

function isValidSiteHostname(value: string): boolean {
  if (value.length < 3 || value.length > 253) {
    return false;
  }
  if (/[A-Z]/.test(value)) {
    return false;
  }
  if (/[^a-z0-9.-]/.test(value)) {
    return false;
  }
  if (value.startsWith(".") || value.endsWith(".")) {
    return false;
  }
  if (value.includes("..")) {
    return false;
  }
  const labels = value.split(".");
  for (const label of labels) {
    if (label.length === 0) {
      return false;
    }
    if (!SITE_LABEL_REGEX.test(label)) {
      return false;
    }
  }
  return true;
}

const SiteSchema = z
  .string()
  .trim()
  .min(3, "invalid site format")
  .max(253, "invalid site format")
  .refine(isValidSiteHostname, "invalid site format");

const DomainSchema = z.string().trim().min(1).toLowerCase().regex(DOMAIN_REGEX, "invalid domain format");
const UsernameSchema = z.string().trim().min(3).toLowerCase().regex(USERNAME_REGEX, "invalid username format");

export function validateSite(input: string): string {
  return SiteSchema.parse(input);
}

export function validateDomain(input: string): string {
  return DomainSchema.parse(input);
}

export function validateUsername(input: string): string {
  return UsernameSchema.parse(input);
}
