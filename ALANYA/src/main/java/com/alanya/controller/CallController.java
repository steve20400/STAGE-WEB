package com.alanya.controller;

import com.alanya.dto.request.CreateCallRequest;
import com.alanya.dto.response.CallResponse;
import com.alanya.security.CurrentUser;
import com.alanya.service.CallService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/calls")
public class CallController {

    @Autowired
    private CallService callService;

    /** GET /api/calls — historique des appels de l'utilisateur. */
    @GetMapping
    public ResponseEntity<Map<String, List<CallResponse>>> list() {
        List<CallResponse> calls = callService.listCalls(CurrentUser.id());
        return ResponseEntity.ok(Map.of("calls", calls));
    }

    /** POST /api/calls — enregistre un nouvel appel sortant. */
    @PostMapping
    public ResponseEntity<Map<String, CallResponse>> create(@Valid @RequestBody CreateCallRequest request) {
        CallResponse call = callService.createCall(CurrentUser.id(), request);
        return ResponseEntity.status(201).body(Map.of("call", call));
    }
}
