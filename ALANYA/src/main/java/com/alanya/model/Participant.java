package com.alanya.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Participation d'un utilisateur a un meeting.
 */
@Entity
@Table(name = "participant")
public class Participant {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "idMeeting", nullable = false)
    private Long meetingId;

    @Column(name = "idParticipant", nullable = false)
    private Integer participantId;

    @Column(name = "status")
    private Byte status = 0;

    @Column(name = "start_time")
    private LocalDateTime startTime;

    @Column(name = "connecte")
    private Byte connecte = 0;

    @Column(name = "duree")
    private Integer duration;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getMeetingId() { return meetingId; }
    public void setMeetingId(Long meetingId) { this.meetingId = meetingId; }
    public Integer getParticipantId() { return participantId; }
    public void setParticipantId(Integer participantId) { this.participantId = participantId; }
    public Byte getStatus() { return status; }
    public void setStatus(Byte status) { this.status = status; }
    public LocalDateTime getStartTime() { return startTime; }
    public void setStartTime(LocalDateTime startTime) { this.startTime = startTime; }
    public Byte getConnecte() { return connecte; }
    public void setConnecte(Byte connecte) { this.connecte = connecte; }
    public Integer getDuration() { return duration; }
    public void setDuration(Integer duration) { this.duration = duration; }
}
