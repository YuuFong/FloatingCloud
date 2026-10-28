// Run TaskbarLyrics' .NET Lyricify provider code on a background worker.
// No UI-thread networking and no direct Netease lyric API.
#include "lyrics_sidecar.h"
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <mutex>
#include <string>
#include <thread>
#include <atomic>

namespace {
std::mutex guard;
std::condition_variable changed;
std::thread worker;
bool running=false,hasPending=false;
std::string latestInput,latestOutput;
uint64_t version=0;

std::string base64(const std::string& data) {
    constexpr char chars[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;out.reserve(((data.size()+2)/3)*4);
    for(size_t i=0;i<data.size();i+=3) {
        const auto a=static_cast<unsigned char>(data[i]);
        const auto b=i+1<data.size()?static_cast<unsigned char>(data[i+1]):0;
        const auto c=i+2<data.size()?static_cast<unsigned char>(data[i+2]):0;
        out.push_back(chars[a>>2]);
        out.push_back(chars[((a&3)<<4)|(b>>4)]);
        out.push_back(i+1<data.size()?chars[((b&15)<<2)|(c>>6)]:'=');
        out.push_back(i+2<data.size()?chars[c&63]:'=');
    }
    return out;
}
std::string launch(const std::string& json) {
    wchar_t path[MAX_PATH]{};
    HMODULE mod=nullptr;
    if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
            GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            reinterpret_cast<LPCWSTR>(&launch),&mod))return {};
    if(!GetModuleFileNameW(mod,path,MAX_PATH))return {};
    const auto exe=std::filesystem::path(path).parent_path()/L"FloatingCloudLyrics.exe";
    if(!std::filesystem::exists(exe))return {};
    wchar_t temp[MAX_PATH]{};
    if(!GetTempPathW(MAX_PATH,temp))return {};
    const auto dest=std::filesystem::path(temp)/
        (L"FloatingCloud-lyrics-"+std::to_wstring(GetCurrentProcessId())+L".json");
    DeleteFileW(dest.c_str());
    const auto encoded=base64(json);
    std::wstring cmd=L"\""+exe.wstring()+L"\" "+std::wstring(encoded.begin(),encoded.end())
        +L" \""+dest.wstring()+L"\"";
    STARTUPINFOW si{sizeof(si)};PROCESS_INFORMATION pi{};
    std::wstring mutableCommand=cmd;
    const BOOL ok=CreateProcessW(exe.c_str(),mutableCommand.data(),nullptr,nullptr,FALSE,
        CREATE_NO_WINDOW,nullptr,nullptr,&si,&pi);
    if(!ok)return {};
    DWORD status=WaitForSingleObject(pi.hProcess,15000);
    if(status==WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess,1);
        WaitForSingleObject(pi.hProcess,3000);
    }
    CloseHandle(pi.hThread);CloseHandle(pi.hProcess);
    if(status!=WAIT_OBJECT_0)return {};
    std::ifstream input(dest,std::ios::binary);
    if(!input)return {};
    std::string text((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
    input.close();DeleteFileW(dest.c_str());
    if(text.size()>512*1024)return {};
    return text;
}
void run() {
    while(true){
        std::string request;uint64_t generation=0;
        {
            std::unique_lock<std::mutex> lock(guard);
            changed.wait(lock,[]{return !running||hasPending;});
            if(!running)break;
            request=std::move(latestInput);
            hasPending=false;generation=version;
        }
        auto result=launch(request);
        {
            std::lock_guard<std::mutex> lock(guard);
            if(generation==version)latestOutput=std::move(result);
        }
    }
}
}
namespace fc_lyrics {
void request(const std::string& json) {
    if(json.empty()||json.size()>8192)return;
    std::lock_guard<std::mutex> lock(guard);
    if(!running){running=true;worker=std::thread(run);}
    latestInput=json;latestOutput.clear();
    hasPending=true;++version;changed.notify_one();
}
std::string poll() {
    std::lock_guard<std::mutex> lock(guard);
    std::string result=std::move(latestOutput);latestOutput.clear();
    return result;
}
void shutdown() {
    {
        std::lock_guard<std::mutex> lock(guard);
        if(!running)return;
        running=false;changed.notify_one();
    }
    if(worker.joinable())worker.join();
}
}
