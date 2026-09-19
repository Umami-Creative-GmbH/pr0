"use client";

import { useQuery } from "@tanstack/react-query";

import { useApiClient } from "./provider";
import { healthQueryOptions } from "./query-options";

export const useHealth = () => useQuery(healthQueryOptions(useApiClient()));
