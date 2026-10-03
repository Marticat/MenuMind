package com.example.demo;

import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")   // чтобы фронт с другого порта мог вызывать
public class GenerationController {

    // быстрая проверка, что бэкенд жив: открой в браузере http://localhost:8080/api/ping
    @GetMapping("/ping")
    public String ping() {
        return "backend is alive";
    }

    @PostMapping("/generate")
    public GenerateResponse generate(@RequestBody GenerateRequest req) {
        Recipe r = req.recipe();

        // собираем описание из данных блюда, без LLM
        List<String> ingList = r.ingredients() == null ? List.of() : r.ingredients();
        String ingredients = ingList.stream().limit(3)
                .map(String::toLowerCase).collect(Collectors.joining(", "));

        String base = r.name() + ". " + safe(r.subtitle()) + " " + safe(r.method());
        if ("concierge".equals(req.tone()) && r.pairing() != null) {
            base += " К блюду: " + r.pairing();
        }

        Map<String, Integer> limits = (req.settings() != null && req.settings().limits() != null)
                ? req.settings().limits()
                : Map.of("yandex", 250, "wolt", 180, "website", 450, "print", 300);

        Map<String, String> texts = new LinkedHashMap<>();
        texts.put("yandex",  constrain(base, limits.getOrDefault("yandex", 250)));
        texts.put("wolt",    constrain(r.name() + ". " + ingredients + ".", limits.getOrDefault("wolt", 180)));
        texts.put("website", constrain(base + " В составе: " + ingredients + ".", limits.getOrDefault("website", 450)));
        texts.put("print",   constrain(r.name() + " / " + safe(r.subtitle()) + ". " + ingredients + ".", limits.getOrDefault("print", 300)));

        String variant = constrain(r.name() + ". " + ingredients + ". " + safe(r.subtitle()),
                limits.getOrDefault("yandex", 250));

        return new GenerateResponse(texts, variant);
    }

    private static String safe(String s) { return s == null ? "" : s; }

    private static String constrain(String text, int max) {
        if (text == null) return "";
        text = text.trim();
        if (text.length() <= max) return text;
        String part = text.substring(0, Math.max(0, max - 1));
        int sp = part.lastIndexOf(' ');
        if (sp > 0) part = part.substring(0, sp);
        return part.replaceAll("[\\s.,;:—]+$", "") + "…";
    }
}