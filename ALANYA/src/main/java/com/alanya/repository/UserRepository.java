package com.alanya.repository;

import com.alanya.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Integer> {
    Optional<User> findByPhone(String phone);
    Optional<User> findByEmail(String email);
    Optional<User> findByPhoneOrEmail(String phone, String email);
    boolean existsByPhone(String phone);
    boolean existsByEmail(String email);
}
