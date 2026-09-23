# PaperGraph bundled runtime notices

The Windows x64 package includes Ollama 0.34.3 from the official standalone
archive. Ollama is copyright Ollama, licensed under MIT. Its full license is
included as OLLAMA-LICENSE.txt. The upstream archive and its embedded copyright,
license and NOTICE files are preserved, including those in lib/ollama.

Official distribution: https://github.com/ollama/ollama/releases/tag/v0.34.3
Official integration instructions: https://docs.ollama.com/windows

The MIT license for Ollama does not replace the separate licenses of its
dependencies. This package includes Go, llama.cpp, LLVM runtimes, C++ libraries
and GPU dependencies; their upstream notices remain beside the runtime files.

NVIDIA CUDA 12.8/13.0 runtime and cuBLAS libraries are distributed as components
of PaperGraph's local semantic processing functionality, not as a standalone SDK.
Their use is subject to the NVIDIA license and restrictions in the accompanying
CUDA-12.8-EULA.html and CUDA-13.0-EULA.html, including the third-party notices.
Those terms apply to NVIDIA components; they are not relicensed under MIT.

Microsoft Visual C++ runtime DLLs supplied in the upstream archive remain subject
to the Microsoft Visual C++ 2015–2022 Runtime terms, included in
MICROSOFT-VC-RUNTIME-TERMS.html. They are provided for running this application.

The BGE-M3 model is downloaded separately on first use and is not part of the
installer. Its license is supplied by the model distribution:
https://ollama.com/library/bge-m3 and https://huggingface.co/BAAI/bge-m3.
No ownership of third-party software or models is claimed by PaperGraph.
