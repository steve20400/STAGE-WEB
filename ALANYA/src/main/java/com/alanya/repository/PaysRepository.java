package com.alanya.repository;

import com.alanya.model.Pays;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface PaysRepository extends JpaRepository<Pays, Integer> {
    Optional<Pays> findByPrefix(String prefix);
}
