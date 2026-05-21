package com.alanya.controller;

import com.alanya.dto.request.UpdateUserRequest;
import com.alanya.dto.response.UserResponse;
import com.alanya.security.CurrentUser;
import com.alanya.service.UserService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/users")
public class UserController {

    @Autowired
    private UserService userService;

    /** GET /api/users/me — Recupere l'utilisateur authentifie. */
    @GetMapping("/me")
    public ResponseEntity<Map<String, UserResponse>> me() {
        UserResponse user = userService.getUserById(CurrentUser.id());
        return ResponseEntity.ok(Map.of("user", user));
    }

    /** PATCH /api/users/me — Modifie partiellement le profil. */
    @PatchMapping("/me")
    public ResponseEntity<Map<String, UserResponse>> update(@Valid @RequestBody UpdateUserRequest request) {
        UserResponse user = userService.updateUser(CurrentUser.id(), request);
        return ResponseEntity.ok(Map.of("user", user));
    }

    /** DELETE /api/users/me — Supprime le compte. */
    @DeleteMapping("/me")
    public ResponseEntity<Void> delete() {
        userService.deleteUser(CurrentUser.id());
        return ResponseEntity.noContent().build();
    }
}
