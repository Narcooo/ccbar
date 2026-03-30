const PRICING_TABLE = {
    "claude-opus-4-6": { in: 15, out: 75, cc5: 18.75, cc1h: 30, cr: 1.5 },
    "claude-opus-4-5": { in: 15, out: 75, cc5: 18.75, cc1h: 30, cr: 1.5 },
    "claude-sonnet-4-5": { in: 3, out: 15, cc5: 3.75, cc1h: 6, cr: 0.3 },
    "claude-sonnet-4-6": { in: 3, out: 15, cc5: 3.75, cc1h: 6, cr: 0.3 },
    "claude-haiku-4-5": { in: 0.8, out: 4, cc5: 1, cc1h: 1.6, cr: 0.08 },
};
const DEFAULT_PRICING = {
    in: 3,
    out: 15,
    cc5: 3.75,
    cc1h: 6,
    cr: 0.3,
};
function resolvePricing(model) {
    const candidates = [model];
    const dotted = model.replaceAll(".", "-");
    if (dotted !== model) {
        candidates.push(dotted);
    }
    for (const candidate of candidates) {
        if (candidate in PRICING_TABLE) {
            return PRICING_TABLE[candidate];
        }
    }
    for (const candidate of candidates) {
        for (const knownModel of Object.keys(PRICING_TABLE)) {
            if (candidate.startsWith(`${knownModel}-`)) {
                return PRICING_TABLE[knownModel];
            }
        }
    }
    return DEFAULT_PRICING;
}
export function estimateCost(model, usage) {
    const pricing = resolvePricing(model);
    const cacheCreation = usage.cache_creation ?? {};
    const cacheCreationTotal = usage.cache_creation_input_tokens ?? 0;
    let cacheCreation5m = cacheCreation.ephemeral_5m_input_tokens ?? 0;
    const cacheCreation1h = cacheCreation.ephemeral_1h_input_tokens ?? 0;
    if (cacheCreationTotal > 0 && cacheCreation5m + cacheCreation1h === 0) {
        cacheCreation5m = cacheCreationTotal;
    }
    const baseCost = ((usage.input_tokens ?? 0) * pricing.in) / 1e6 +
        ((usage.output_tokens ?? 0) * pricing.out) / 1e6 +
        (cacheCreation5m * pricing.cc5) / 1e6 +
        (cacheCreation1h * pricing.cc1h) / 1e6;
    const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) * pricing.cr) / 1e6;
    return { baseCost, cacheReadCost };
}
