package com.example.demo;
import java.util.Map;

public record Settings(Integer restraint, Integer sensory, Integer strictness, Map<String, Integer> limits) {}