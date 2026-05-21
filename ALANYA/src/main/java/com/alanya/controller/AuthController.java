package com.alanya.controller;

import com.alanya.dto.request.LoginRequest;
import com.alanya.dto.request.RegisterRequest;
import com.alanya.dto.response.AuthResponse;
import com.alanya.service.AuthService;
import com.alanya.service.UserService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    @Autowired
    private AuthService authService;

    @Autowired
    private UserService userService;

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.ok(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @PostMapping("/register-otp")
    public ResponseEntity<Map<String, String>> requestRegistrationOtp(@Valid @RequestBody RegisterRequest request) {
        String otp = authService.requestRegistrationOtp(request);
        return ResponseEntity.ok(Map.of("debugOtp", otp));
    }

    /**
     * POST /api/auth/logout — Marque l'utilisateur hors ligne.
     * Le JWT etant stateless, le client doit supprimer son token apres cet appel.
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Integer userId) {
            userService.setOffline(userId);
        }
        SecurityContextHolder.clearContext();
        return ResponseEntity.noContent().build();
    }
}
