package com.alanya.service;

import com.alanya.dto.request.CreateCallRequest;
import com.alanya.dto.response.CallResponse;
import com.alanya.model.CallHistory;
import com.alanya.model.User;
import com.alanya.repository.CallHistoryRepository;
import com.alanya.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class CallService {

    @Autowired
    private CallHistoryRepository callRepository;

    @Autowired
    private UserRepository userRepository;

    /** GET /calls — historique des appels (passes ou recus) de l'utilisateur. */
    public List<CallResponse> listCalls(Integer userId) {
        List<CallHistory> calls = callRepository.findByCallerIdOrReceiverIdOrderByCreatedAtDesc(userId, userId);

        // Pre-charger les users pour eviter N+1
        Map<Integer, User> usersById = preloadUsers(calls, userId);

        return calls.stream()
                .map(c -> toResponse(c, userId, usersById))
                .collect(Collectors.toList());
    }

    /** POST /calls — enregistre un nouvel appel sortant. */
    public CallResponse createCall(Integer userId, CreateCallRequest request) {
        Integer contactId = parseId(request.getContactId());
        if (contactId.equals(userId)) {
            throw new RuntimeException("Impossible de s'appeler soi-meme.");
        }
        User receiver = userRepository.findById(contactId)
                .orElseThrow(() -> new RuntimeException("Contact introuvable."));

        CallHistory call = new CallHistory();
        call.setCallerId(userId);
        call.setReceiverId(receiver.getId());
        call.setType(typeStringToShort(request.getType()));
        call.setStatus((short) 0); // 0 = "ended" (par defaut, sera mis a jour par le signaling WebRTC)
        call.setCreatedAt(LocalDateTime.now());
        call.setDuration(0);
        call = callRepository.save(call);

        Map<Integer, User> usersById = new HashMap<>();
        usersById.put(receiver.getId(), receiver);
        return toResponse(call, userId, usersById);
    }

    /* ----- Helpers ----- */

    private Map<Integer, User> preloadUsers(List<CallHistory> calls, Integer currentUserId) {
        Map<Integer, User> map = new HashMap<>();
        calls.stream()
                .flatMap(c -> java.util.stream.Stream.of(c.getCallerId(), c.getReceiverId()))
                .filter(id -> !id.equals(currentUserId))
                .distinct()
                .forEach(id -> userRepository.findById(id).ifPresent(u -> map.put(id, u)));
        return map;
    }

    private CallResponse toResponse(CallHistory call, Integer currentUserId, Map<Integer, User> usersById) {
        boolean isOutgoing = call.getCallerId().equals(currentUserId);
        Integer otherId = isOutgoing ? call.getReceiverId() : call.getCallerId();
        User other = usersById.get(otherId);

        String contactName = other != null ? other.getName() : "Inconnu";
        String contactInitials = computeInitials(contactName);

        String direction;
        if (isOutgoing) {
            direction = "out";
        } else if (call.getStatus() != null && call.getStatus() == 2) {
            direction = "missed"; // no_answer
        } else {
            direction = "in";
        }

        return new CallResponse(
                String.valueOf(call.getId()),
                String.valueOf(otherId),
                contactName,
                contactInitials,
                direction,
                typeShortToString(call.getType()),
                statusShortToString(call.getStatus()),
                formatDuration(call.getDuration()),
                call.getCreatedAt(),
                false // isGroup : pas encore implemente (passerait par Meeting)
        );
    }

    private Integer parseId(String idStr) {
        try {
            return Integer.parseInt(idStr);
        } catch (NumberFormatException e) {
            throw new RuntimeException("contactId invalide.");
        }
    }

    private Short typeStringToShort(String type) {
        if (type == null) return 0;
        return "video".equalsIgnoreCase(type) ? (short) 1 : (short) 0;
    }

    private String typeShortToString(Short type) {
        return type != null && type == 1 ? "video" : "audio";
    }

    private String statusShortToString(Short status) {
        if (status == null) return "ended";
        return switch (status.intValue()) {
            case 1 -> "declined";
            case 2 -> "no_answer";
            default -> "ended";
        };
    }

    /** 87 secondes -> "01:27" ; 3725 -> "62:05" */
    private String formatDuration(Integer seconds) {
        if (seconds == null || seconds <= 0) return "00:00";
        int m = seconds / 60;
        int s = seconds % 60;
        return String.format("%02d:%02d", m, s);
    }

    private String computeInitials(String name) {
        if (name == null || name.isBlank()) return "??";
        String[] parts = name.trim().split("\\s+");
        if (parts.length == 1) {
            String w = parts[0];
            return (w.length() >= 2 ? w.substring(0, 2) : w).toUpperCase();
        }
        String first = String.valueOf(parts[0].charAt(0));
        String last = String.valueOf(parts[parts.length - 1].charAt(0));
        return (first + last).toUpperCase();
    }
}
