# Windows 실행 환경

Windows x64 배포 ZIP에는 Python Software Foundation의 CPython 3.14.9 Windows embeddable package (64-bit)가 들어 있습니다. Python 배포본의 라이선스 원문은 ZIP의 `runtime/LICENSE.txt`에서 읽을 수 있습니다. [Python 3.14.9 배포 페이지](https://www.python.org/downloads/release/python-3149/) · [Python에 포함된 소프트웨어의 라이선스와 저작권 고지](https://docs.python.org/3.14/license.html#licenses-and-acknowledgements-for-incorporated-software)

배포 스크립트는 Python 공식 서명 자료에 기록된 SHA-256을 확인한 뒤 공식 ZIP의 파일들을 `runtime` 폴더에 그대로 담습니다.
