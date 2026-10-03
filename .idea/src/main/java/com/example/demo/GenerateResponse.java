package com.example.demo;
import java.util.Map;

public record GenerateResponse(Map<String, String> texts, String variant) {}