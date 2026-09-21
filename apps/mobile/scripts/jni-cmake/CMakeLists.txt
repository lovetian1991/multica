cmake_minimum_required(VERSION 3.13)
set(CMAKE_OBJECT_PATH_MAX 250 CACHE STRING "Maximum object file path length for Ninja on Windows" FORCE)
project(appmodules)
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
