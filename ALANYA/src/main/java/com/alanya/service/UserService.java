package com.alanya.service;

import com.alanya.dto.request.UpdateUserRequest;
import com.alanya.dto.response.UserResponse;
import com.alanya.model.User;
import com.alanya.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    public UserResponse getUserById(Integer userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        return toResponse(user);
    }

    public Integer getUserIdByPhone(String phone) {
        return userRepository.findByPhone(phone)
                .orElseThrow(() -> new RuntimeException("User not found"))
                .getId();
    }

    /**
     * Met a jour les champs non-null de la requete.
     * Le numero de telephone et l'ID ne sont jamais modifiables ici.
     */
    public UserResponse updateUser(Integer userId, UpdateUserRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (request.getName() != null && !request.getName().isBlank()) {
            user.setName(request.getName().trim());
        }
        if (request.getEmail() != null && !request.getEmail().isBlank()) {
            String email = request.getEmail().trim().toLowerCase();
            // Verifier que l'email n'est pas deja pris par un autre utilisateur
            userRepository.findByEmail(email).ifPresent(other -> {
                if (!other.getId().equals(userId)) {
                    throw new RuntimeException("Cette adresse email est deja utilisee.");
                }
            });
            user.setEmail(email);
        }
        if (request.getStatusMsg() != null) {
            user.setStatusMsg(request.getStatusMsg().trim());
        }
        if (request.getAvatar() != null) {
            user.setAvatarUrl(request.getAvatar().isBlank() ? null : request.getAvatar().trim());
        }

        return toResponse(userRepository.save(user));
    }

    public void deleteUser(Integer userId) {
        if (!userRepository.existsById(userId)) {
            throw new RuntimeException("User not found");
        }
        userRepository.deleteById(userId);
    }

    /**
     * Passe l'utilisateur en hors ligne. Appele lors du logout.
     */
    public void setOffline(Integer userId) {
        userRepository.findById(userId).ifPresent(user -> {
            user.setIsOnline(false);
            user.setLastSeen(LocalDateTime.now());
            userRepository.save(user);
        });
    }

    private UserResponse toResponse(User user) {
        return new UserResponse(
                user.getId(),
                user.getName(),
                user.getPhone(),
                user.getEmail(),
                user.getAvatarUrl(),
                user.getIsOnline(),
                user.getStatusMsg(),
                user.getCreatedAt()
        );
    }
}
