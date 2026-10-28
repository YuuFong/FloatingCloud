#pragma once
#include <string>
namespace fc_lyrics {
void request(const std::string& json);
std::string poll();
void shutdown();
}
