package dev.dacruz.clinic.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;

/** Reads who is calling from the validated JWT, never from anything the client can send in a body or header. */
public final class Principals {

    private Principals() {}

    public static String name(Authentication auth) {
        return auth.getName();
    }

    /** "ADMIN" or "REVIEWER": the first ROLE_ authority with its prefix removed. */
    public static String role(Authentication auth) {
        for (GrantedAuthority a : auth.getAuthorities()) {
            String s = a.getAuthority();
            if (s.startsWith("ROLE_")) {
                return s.substring("ROLE_".length());
            }
        }
        return "NONE";
    }
}
