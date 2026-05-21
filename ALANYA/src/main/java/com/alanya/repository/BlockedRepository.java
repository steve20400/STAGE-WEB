package com.alanya.repository;

import com.alanya.model.Blocked;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface BlockedRepository extends JpaRepository<Blocked, Long> {
    List<Blocked> findByUserId(Integer userId);
    boolean existsByUserIdAndBlockedUserId(Integer userId, Integer blockedUserId);
}
