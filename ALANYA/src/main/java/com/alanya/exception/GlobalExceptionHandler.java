package com.alanya.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * Intercepte les exceptions de tous les controllers et renvoie
 * un JSON uniforme : { "message": "..." }
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** Erreurs de validation (@Valid sur un DTO). */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException ex) {
        FieldError first = ex.getBindingResult().getFieldErrors().stream().findFirst().orElse(null);
        String message = first != null
                ? first.getDefaultMessage()
                : "Requete invalide.";
        return error(HttpStatus.BAD_REQUEST, message);
    }

    /** Pas authentifie. */
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, String>> handleAuth(AuthenticationException ex) {
        return error(HttpStatus.UNAUTHORIZED, "Authentification requise.");
    }

    /** Authentifie mais pas autorise. */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, String>> handleForbidden(AccessDeniedException ex) {
        return error(HttpStatus.FORBIDDEN, "Acces refuse.");
    }

    /**
     * Erreur metier classique (lancee par les services).
     * On la mappe sur 400 par defaut.
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        return error(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    /** Filet de securite : erreur inattendue. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleUnexpected(Exception ex) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "Erreur interne du serveur.");
    }

    private ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("message", message));
    }
}
