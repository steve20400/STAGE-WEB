package com.alanya.repository;

import com.alanya.model.Meeting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface MeetingRepository extends JpaRepository<Meeting, Long> {
    List<Meeting> findByOrganiserId(Integer organiserId);
    List<Meeting> findByIsEndFalse();
}
