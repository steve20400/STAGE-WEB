package com.alanya.service;

import com.alanya.dto.request.LoginRequest;
import com.alanya.dto.request.RegisterRequest;
import com.alanya.dto.response.AuthResponse;
import com.alanya.dto.response.UserResponse;
import com.alanya.model.User;
import com.alanya.repository.UserRepository;
import com.alanya.security.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.Random;

@Service
public class AuthService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private UserService userService;

    @Autowired
    private JwtUtil jwtUtil;

    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByPhone(request.getPhone())) {
            throw new RuntimeException("Phone already registered");
        }
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new RuntimeException("Email already registered");
        }

        User user = new User();
        user.setName(request.getName());
        user.setPhone(request.getPhone());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setCreatedAt(LocalDateTime.now());
        user.setIsOnline(true);

        user = userRepository.save(user);

        UserResponse userResponse = userService.getUserById(user.getId());
        String accessToken = jwtUtil.generateAccessToken(user.getId(), user.getPhone());
        String refreshToken = jwtUtil.generateRefreshToken(user.getId(), user.getPhone());

        return new AuthResponse(accessToken, refreshToken, userResponse);
    }

    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByPhoneOrEmail(request.getIdentifier(), request.getIdentifier())
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new RuntimeException("Invalid password");
        }

        user.setIsOnline(true);
        user.setLastSeen(LocalDateTime.now());
        userRepository.save(user);

        UserResponse userResponse = userService.getUserById(user.getId());
        String accessToken = jwtUtil.generateAccessToken(user.getId(), user.getPhone());
        String refreshToken = jwtUtil.generateRefreshToken(user.getId(), user.getPhone());

        return new AuthResponse(accessToken, refreshToken, userResponse);
    }

    public String requestRegistrationOtp(RegisterRequest request) {
        return String.format("%06d", new Random().nextInt(999999));
    }
}
