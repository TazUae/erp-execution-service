import { z } from "zod";

export const SITE_REGEX = /^[a-z0-9-]+$/;
export const DOMAIN_REGEX = /^(?=.{3,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
export const USERNAME_REGEX = /^[a-z][a-z0-9_.-]{2,63}$/;

const SiteSchema = z.string().trim().min(1).regex(SITE_REGEX, "invalid site format");
const BoundedSiteSchema = SiteSchema.min(3).max(50);
const DomainSchema = z.string().trim().min(1).toLowerCase().regex(DOMAIN_REGEX, "invalid domain format");
const UsernameSchema = z.string().trim().min(3).toLowerCase().regex(USERNAME_REGEX, "invalid username format");

export function validateSite(input: string): string {
  return BoundedSiteSchema.parse(input);
}

export function validateDomain(input: string): string {
  return DomainSchema.parse(input);
}

export function validateUsername(input: string): string {
  return UsernameSchema.parse(input);
}
