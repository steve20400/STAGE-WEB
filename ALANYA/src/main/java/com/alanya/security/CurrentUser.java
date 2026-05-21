package com.alanya.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Helper pour recuperer l'utilisateur authentifie depuis le SecurityContext.
 * Le JwtFilter y a mis l'userId comme Principal.
 */
public final class CurrentUser {

    private CurrentUser() {}

    public static Integer id() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof Integer)) {
            throw new RuntimeException("Aucun utilisateur authentifie.");
        }
        return (Integer) auth.getPrincipal();
    }
}
