// FloatingCloud: consent-scoped desktop-audio spectrum (WASAPI loopback).
// Visual design and adaptive band scaling informed by TaskbarLyrics (MIT).
#include "spectrum.h"
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <array>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <complex>
#include <cstdint>
#include <mutex>
#include <sstream>
#include <iomanip>
#include <thread>

using Microsoft::WRL::ComPtr;
namespace {
constexpr size_t N=1024;
constexpr size_t RING=8192;
constexpr size_t BARS=21;
std::atomic<bool> runFlag{false};
std::atomic<bool> audioAvailable{false};
std::thread captureThread;
std::mutex captureGate, samplesGate, frameGate;
std::array<float,RING> ring{};
size_t writePos=0, written=0;
unsigned sampleRate=48000;
std::array<float,BARS> smooth{};
float adaptivePeak=0.035f;
void push(float value) {
    ring[writePos]=std::clamp(value,-1.f,1.f);
    writePos=(writePos+1)%RING;
    written=std::min(RING,written+1);
}
void capture() {
    const HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    if(FAILED(com))return;
    while(runFlag.load()) {
        ComPtr<IMMDeviceEnumerator> enumerator;
        ComPtr<IMMDevice> device;
        ComPtr<IAudioClient> client;
        ComPtr<IAudioCaptureClient> input;
        WAVEFORMATEX* mix=nullptr;
        HRESULT hr=CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator));
        if(SUCCEEDED(hr))hr=enumerator->GetDefaultAudioEndpoint(eRender,eConsole,&device);
        if(SUCCEEDED(hr))hr=device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(client.GetAddressOf()));
        if(SUCCEEDED(hr))hr=client->GetMixFormat(&mix);
        bool isFloat=false,isPcm=false;
        if(SUCCEEDED(hr)&&mix) {
            const WORD format=mix->wFormatTag;
            isFloat=(format==WAVE_FORMAT_IEEE_FLOAT);
            isPcm=(format==WAVE_FORMAT_PCM);
            if(format==WAVE_FORMAT_EXTENSIBLE && mix->cbSize >= 22){
                auto* ext=reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix);
                isFloat=IsEqualGUID(ext->SubFormat,KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
                isPcm=IsEqualGUID(ext->SubFormat,KSDATAFORMAT_SUBTYPE_PCM);
            }
            if(!(isFloat||isPcm) || mix->nChannels==0 || mix->nSamplesPerSec==0)
                hr=E_FAIL;
        }
        if(SUCCEEDED(hr))hr=client->Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,10000000,0,mix,nullptr);
        if(SUCCEEDED(hr))hr=client->GetService(IID_PPV_ARGS(&input));
        if(SUCCEEDED(hr))hr=client->Start();
        if(SUCCEEDED(hr)) {
            audioAvailable.store(true);
            {
                std::lock_guard<std::mutex> lock(samplesGate);
                sampleRate=mix->nSamplesPerSec;
            }
            const auto endTime=std::chrono::steady_clock::now()+std::chrono::hours(48);
            while(runFlag.load() && std::chrono::steady_clock::now()<endTime) {
                UINT32 packets=0;
                if(FAILED(input->GetNextPacketSize(&packets)))break;
                while(packets && runFlag.load()) {
                    BYTE* data=nullptr;UINT32 frames=0;DWORD flags=0;
                    if(FAILED(input->GetBuffer(&data,&frames,&flags,nullptr,nullptr))){packets=0;break;}
                    {
                        std::lock_guard<std::mutex> lock(samplesGate);
                        const size_t channels=mix->nChannels;
                        const int bytes=mix->wBitsPerSample/8;
                        for(UINT32 n=0;n<frames;n++){
                            float level=0;
                            if(!(flags&AUDCLNT_BUFFERFLAGS_SILENT) && data && bytes>0){
                                for(size_t c=0;c<channels;c++){
                                    const BYTE* p=data+(static_cast<size_t>(n)*channels+c)*bytes;
                                    float v=0;
                                    if(isFloat && bytes==4) {
                                        // memcpy avoids unaligned/aliasing reads.
                                        std::memcpy(&v,p,sizeof(float));
                                        if(!std::isfinite(v))v=0;
                                    } else if(isPcm && bytes==2) {
                                        int16_t raw;std::memcpy(&raw,p,sizeof(raw));v=raw/32768.f;
                                    } else if(isPcm && bytes==4) {
                                        int32_t raw;std::memcpy(&raw,p,sizeof(raw));v=raw/2147483648.f;
                                    } else if(isPcm && bytes==3) {
                                        int32_t raw=int32_t(p[0])|(int32_t(p[1])<<8)|(int32_t(p[2])<<16);
                                        if(raw&0x800000)raw|=~0xffffff;
                                        v=raw/8388608.f;
                                    }
                                    level+=v;
                                }
                                level/=static_cast<float>(channels);
                            }
                            push(level);
                        }
                    }
                    input->ReleaseBuffer(frames);
                    if(FAILED(input->GetNextPacketSize(&packets))){packets=0;break;}
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(15));
            }
            client->Stop();
        }
        audioAvailable.store(false);
        if(mix)CoTaskMemFree(mix);
        if(runFlag.load())std::this_thread::sleep_for(std::chrono::milliseconds(350));
    }
    CoUninitialize();
}
void fft(std::array<std::complex<double>,N>& v) {
    for(size_t i=1,j=0;i<N;i++){
        size_t bit=N>>1;
        for(;j&bit;bit>>=1)j^=bit;
        j^=bit;
        if(i<j)std::swap(v[i],v[j]);
    }
    for(size_t width=2;width<=N;width*=2){
        double a=-2*3.14159265358979323846/static_cast<double>(width);
        std::complex<double> step(std::cos(a),std::sin(a));
        for(size_t i=0;i<N;i+=width){
            std::complex<double> w(1,0);
            for(size_t k=0;k<width/2;k++){
                auto x=v[i+k],y=v[i+k+width/2]*w;
                v[i+k]=x+y;v[i+k+width/2]=x-y;w*=step;
            }
        }
    }
}
} // namespace

namespace fc_spectrum {
void enable(bool on) {
    std::lock_guard<std::mutex> guard(captureGate);
    if(on) {
        if(runFlag.exchange(true))return;
        captureThread=std::thread(capture);
    } else {
        runFlag.store(false);
        if(captureThread.joinable())captureThread.join();
        audioAvailable.store(false);
        std::lock_guard<std::mutex> lock(samplesGate);
        ring.fill(0);written=0;writePos=0;
    }
}
void shutdown() { enable(false); }
bool available(){return audioAvailable.load();}
std::string readJson() {
    if(!runFlag.load()||!audioAvailable.load())return "[]";
    std::array<std::complex<double>,N> data{};
    unsigned rate=48000;
    {
        std::lock_guard<std::mutex> lock(samplesGate);
        rate=sampleRate;
        size_t start=(writePos+RING-N)%RING;
        for(size_t i=0;i<N;i++){
            const double window=0.5-0.5*std::cos(2*3.14159265358979323846*i/(N-1));
            data[i]=static_cast<double>(ring[(start+i)%RING])*window;
        }
    }
    fft(data);
    std::array<float,BARS> bands{};
    float peak=0;
    for(size_t i=0;i<BARS;i++){
        const double lo=55.0*std::pow(13000.0/55.0,static_cast<double>(i)/BARS);
        const double hi=55.0*std::pow(13000.0/55.0,static_cast<double>(i+1)/BARS);
        const auto minBin=std::max<size_t>(1,static_cast<size_t>(std::floor(lo*N/rate)));
        const auto maxBin=std::min<size_t>(N/2,static_cast<size_t>(std::ceil(hi*N/rate)));
        double total=0;size_t count=0;
        for(size_t k=minBin;k<=maxBin;k++) {
            total+=std::abs(data[k])*2.0/N;
            count++;
        }
        bands[i]=static_cast<float>((count?total/count:0)*(1.3+0.045*i));
        peak=std::max(peak,bands[i]);
    }
    std::lock_guard<std::mutex> lock(frameGate);
    adaptivePeak=std::clamp(std::max(peak,adaptivePeak*0.97f),0.004f,0.7f);
    std::ostringstream out;out<<'['<<std::fixed<<std::setprecision(3);
    for(size_t i=0;i<BARS;i++) {
        float goal=std::clamp((bands[i]/adaptivePeak-0.04f)/0.96f,0.f,1.f);
        smooth[i]+= (goal>smooth[i]?0.53f:0.22f)*(goal-smooth[i]);
        if(i)out<<',';
        out<<smooth[i];
    }
    out<<']';return out.str();
}
} // namespace fc_spectrum
