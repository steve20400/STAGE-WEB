package com.alanya.security;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Intercepte chaque requete HTTP, extrait le token "Authorization: Bearer ..."
 * et configure le SecurityContext si le token est valide.
 *
 * Pas de rejet ici : si pas de token ou token invalide, on laisse passer
 * et Spring Security decidera (selon les regles de SecurityConfig).
 */
@Component
public class JwtFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {

        String header = request.getHeader("Authorization");

        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            try {
                Claims claims = jwtUtil.parse(token);
                Integer userId = Integer.parseInt(claims.getSubject());
                String phone = claims.get("phone", String.class);

                // Le "principal" est l'userId. On peut le recuperer dans n'importe
                // quel controller via : (Integer) authentication.getPrincipal()
                UsernamePasswordAuthenticationToken auth =
                        new UsernamePasswordAuthenticationToken(
                                userId,
                                null,
                                List.of(new SimpleGrantedAuthority("USER")));
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (Exception e) {
                // Token invalide / expire : on laisse SecurityContext vide,
                // Spring renverra 401 si la route exige une authentification.
                SecurityContextHolder.clearContext();
            }
        }

        chain.doFilter(request, response);
    }
}
