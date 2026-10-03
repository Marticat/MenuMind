package com.example.demo;
import java.util.List;

public record Recipe(String id, String name, String subtitle, List<String> ingredients,
                     String method, String category, Integer weight, Integer price, String pairing) {}