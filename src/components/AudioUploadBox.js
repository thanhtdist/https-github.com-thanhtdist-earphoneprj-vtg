import React, { useState, useRef } from "react";
import { FaUpload, FaPlay, FaPause, FaTimes, FaFile } from "react-icons/fa";
import "../styles/AudioUploadBox.css";
import { uploadFileToS3 } from '../services/S3Service';

const AudioUploadBox = ({ meetingSession, logger }) => {
    console.log('meetingSession zzz:', meetingSession);
    console.log('logger zzz:', logger);
    const [voiceFileType, setVoiceFileType] = useState("instruction"); // Tracks the current voice type
    const [uploading, setUploading] = useState(false); // Tracks upload state
    const [audioFiles, setAudioFiles] = useState({
        instruction: null,
        closingSpeech: null,
    }); // Tracks the audio file for each type
    const [errorMessage, setErrorMessage] = useState("");
    const [isPlaying, setIsPlaying] = useState(false);
    const audioElementRef = useRef(null);
    const audioContextRef = useRef(null);
    const mediaElementSourceRef = useRef(null);
    const MAX_FILE_SIZE_MB = 20; // Maximum file size limit in MB

    const handleVoiceFileTypeChange = (e) => {
        setVoiceFileType(e.target.value);
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            setIsPlaying(false);
        }
    };

    const handleFileUpload = async (event) => {
        setErrorMessage(""); // Reset error message 
        const file = event.target.files[0];
        console.log('Current file:', file);
        logger.info('Current file:' + JSON.stringify(file));
        if (file) {
            if (!file.type.startsWith("audio")) {
                setErrorMessage(`Unsupported file type ${file.type}. Please upload an audio file.`);
                return;
            }

            if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
                setErrorMessage(`File size exceeds ${MAX_FILE_SIZE_MB} MB. Please upload a smaller file.`);
                return;
            }
            setUploading(true); // Start uploading
            // const fileURL = URL.createObjectURL(file);
            try {
                // store attachment into S3
                const uploadFileToS3Response = await uploadFileToS3(file);
                console.log('Voice file uploaded successfully:', uploadFileToS3Response);
                //const fileUrl = uploadFileToS3Response.Location;
                setAudioFiles((prevState) => ({
                    ...prevState,
                    [voiceFileType]: { name: file.name, url: uploadFileToS3Response.Location },
                }));
            } catch (error) {
                console.error('An error occurred during the upload: ' + JSON.stringify(error));
                logger.error('An error occurred during the upload: ' + JSON.stringify(error));
                setErrorMessage("An error occurred during the upload. Please try again.");
            } finally {
                setUploading(false);
            }
        }
    };

    // const applyAudioTransformations = (audioElement) => {
    //   const audioContext = new AudioContext();

    //   // Create a media element source node from the MP3 file
    //   const mediaElementSource = audioContext.createMediaElementSource(audioElement);

    //   // Apply gain (volume adjustment)
    //   const gainNode = audioContext.createGain();
    //   gainNode.gain.value = 1.2; // Increase volume by 20%

    //   // Connect the nodes (source -> gain -> destination)
    //   mediaElementSource.connect(gainNode).connect(audioContext.destination);

    //   console.log("Audio transformations applied:", gainNode);

    //   return gainNode;
    // };

    const playVoiceAudio = async (fileUrl) => {
        try {
            if (!audioElementRef.current) {
                // Create and configure the audio element
                const audioElement = new Audio(fileUrl);
                audioElement.crossOrigin = "anonymous";

                // Apply transformations
                //applyAudioTransformations(audioElement);

                // Assign to ref
                audioElementRef.current = audioElement;
                // Create AudioContext and connect to media element source
                //const audioContext = new AudioContext();
                if (!audioContextRef.current) {
                    audioContextRef.current = new AudioContext();
                }
                if (!mediaElementSourceRef.current) {

                    mediaElementSourceRef.current = audioContextRef.current.createMediaElementSource(audioElement);
                    const destination = audioContextRef.current.createMediaStreamDestination();
                    mediaElementSourceRef.current.connect(destination);

                    // Apply transformations (e.g., gain, filters) to the MP3 stream
                    // Apply gain (volume adjustment)
                    const gainNode = audioContextRef.current.createGain();
                    gainNode.gain.value = 1.2; // Increase volume by 20%
                    // Connect the nodes: source -> gain -> destination
                    mediaElementSourceRef.current.connect(gainNode).connect(audioContextRef.current.destination);

                    // Get the MP3 stream
                    const mp3Stream = destination.stream;
                    console.log("MP3 stream: ", mp3Stream);
                    logger.info("MP3 stream: " + JSON.stringify(mp3Stream));

                    // Start broadcasting the MP3 file to the Chime meeting
                    await meetingSession.audioVideo.startAudioInput(mp3Stream);
                }

            }

            // Play the audio for the users to hear
            await audioElementRef.current.play();
        } catch (error) {
            console.error("Error playing voice audio:", error);
            logger.error("Error playing voice audio:" + JSON.stringify(error));
        }
    };


    const handlePlayPause = async () => {
        const currentAudioFile = audioFiles[voiceFileType];
        if (currentAudioFile) {
            if (isPlaying) {
                // Pause the audio
                audioElementRef.current.pause();
                setIsPlaying(false);
            } else {
                // Play the audio
                await playVoiceAudio(currentAudioFile.url);
                setIsPlaying(true);
            }
        }
    };

    const handleRemoveFile = () => {
        console.log('handleRemoveFile');
        // // Pause the audio if it's playing
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            audioElementRef.current = null;
        }

        // Reset the audio files state for the current voice type
        setAudioFiles((prevState) => ({
            ...prevState,
            [voiceFileType]: null, // Remove the current audio file
        }));

        // Reset the playing state to false
        setIsPlaying(false);
    };

    const currentAudioFile = audioFiles[voiceFileType];
    console.log('currentAudioFile:', currentAudioFile);

    return (
        <>
            <h3>Play the voice file for</h3>
            <select value={voiceFileType} onChange={handleVoiceFileTypeChange}>
                <option value="instruction">Instruction</option>
                <option value="closingSpeech">Closing Speech</option>
            </select>
            <div className="audio-upload-container">
                {uploading ? (
                    <p>Uploading...</p>
                ) : currentAudioFile ? (
                    <div className="audio-box">
                        <div
                            className="icon-wrapper"
                            onClick={handleRemoveFile} // Ensure the click event is attached here
                        >
                            <FaTimes size={16} />
                        </div>
                        <div className="audio-content">
                            <FaFile size={60} className="audio-icon" />
                            <div
                                className="play-pause-icon"
                                onClick={handlePlayPause}
                                style={{ zIndex: 10 }} // Ensure play/pause icon is above the file icon
                            >
                                {isPlaying ? <FaPause size={24} /> : <FaPlay size={24} />}
                            </div>
                        </div>
                    </div>
                ) : (
                    <label className="upload-box">
                        <FaUpload size={60} />
                        <input
                            type="file"
                            //accept=".mp3, .mp4, .m4a, .aac, .wav"
                            accept="audio/*"
                            onChange={handleFileUpload}
                            className="hidden-input"
                        />
                    </label>
                )}
            </div>
            {errorMessage && <p className="error-message">{errorMessage}</p>}
            {currentAudioFile && (<p><a target="_blank" rel="noopener noreferrer" href={currentAudioFile.url} style={{ color: "green" }}>{currentAudioFile.name}</a></p>)}
        </>
    );
};

export default AudioUploadBox;