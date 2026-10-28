// FloatingCloud 0.4.3 — native WASAPI loopback spectrum input.
// Adapted conceptually from TaskbarLyrics' SystemAudioSpectrumService (MIT).
// No synthetic/random audio samples. Capture starts only in instrumental mode.
#pragma once
#include <string>
namespace fc_spectrum {
void enable(bool on);
void shutdown();
bool available();
std::string readJson();
}
