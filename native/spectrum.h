// FloatingCloud 0.4.9 — native WASAPI loopback spectrum input.
// Adapted from TaskbarLyrics v1.7.4 SystemAudioSpectrumService (MIT).
// No synthetic/random audio samples. Capture starts only in instrumental mode.
#pragma once
#include <string>
namespace fc_spectrum {
void enable(bool on);
void shutdown();
bool available();
std::string readJson();
}
