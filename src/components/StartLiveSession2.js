import React, { useState, useEffect, useCallback } from 'react';
import {
  createMeeting,
  createAttendee,
  createAppInstanceUsers,
  createChannel,
  addChannelMembership,
  startMeetingTranscription,
  translateTextSpeech
} from '../apis/api';
import {
  DefaultDeviceController,
  DefaultMeetingSession,
  ConsoleLogger,
  //MultiLogger,
  LogLevel,
  MeetingSessionConfiguration,
  VoiceFocusDeviceTransformer,
} from 'amazon-chime-sdk-js';
import '../styles/StartLiveSession.css';
import ChatMessage from './ChatMessage';
import Participants from './Participants';
import AudioUploadBox from './AudioUploadBox';
import Config from '../utils/config';
import metricReport from '../utils/MetricReport';
//import { getPOSTLogger } from '../utils/MeetingLogger';
import { checkAvailableMeeting } from '../utils/MeetingUtils';
import JSONCookieUtils from '../utils/JSONCookieUtils';
import { v4 as uuidv4 } from 'uuid';
import { QRCodeSVG } from 'qrcode.react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMicrophone, faMicrophoneSlash,
} from '@fortawesome/free-solid-svg-icons';
import { useTranslation } from 'react-i18next';
// import { uploadFileToS3 } from '../services/S3Service';

/**
 * Component to start a live audio session for the main speaker
 * The main speaker can start a live audio session and share the QR code with the sub-speaker or listener
 * The main speaker can talk & listen from the sub-speaker
 * The main speaker can also chat with the sub-speaker or listener
 */
function StartLiveSession() {
  // Use translation
  const { t, i18n } = useTranslation();
  console.log('i18n', i18n);
  console.log('t', t);

  // States to manage the meeting session
  const [channelArn, setChannelArn] = useState('');
  const [channelID, setChannelID] = useState('');
  const [meetingSession, setMeetingSession] = useState(null);
  const [meeting, setMetting] = useState(null);
  const [attendee, setAttendee] = useState(null);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [userArn, setUserArn] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [chatSetting, setChatSetting] = useState('guideOnly'); // State to manage chat setting
  const [selectedQR, setSelectedQR] = useState('listener'); // State to manage selected QR type
  const [isMicOn, setIsMicOn] = useState(false); // State for microphone status
  const [transformVFD, setTransformVFD] = useState(null);
  const [microChecking, setMicroChecking] = useState(t('microChecking'));
  const [noMicroMsg, setNoMicoMsg] = useState(t('noMicroMsg'));
  const [logger, setLogger] = useState(null);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [transcripts, setTranscriptions] = useState([]);
  const [lines, setLine] = useState(null);
  const [translatedText, setTranslatedText] = useState(null);
  const [sourceLanguageCode, setSourceLanguageCode] = useState(null);

  // Function to start a live audio session
  const startLiveAduioSession = async () => {
    setIsLoading(true);
    // Delete the cookie
    JSONCookieUtils.deleteCookie("Main-Guide");
    console.log("Cookie deleted successfully!");
    try {
      const userID = uuidv4();
      setUserId(userID);
      const userType = `Guide`;
      const userName = `Guide`;

      const meeting = await createMeeting();
      console.log('Meeting created:', meeting);
      const attendee = await createAttendee(meeting.MeetingId, `${userType}|${Date.now()}`);
      console.log('Attendee created:', attendee);

      // Initialize the meeting session such as meeting session
      initializeMeetingSession(meeting, attendee);
      const createAppUserAndChannelResponse = await createAppUserAndChannel(userID, userName);
      setMetting(meeting);
      setAttendee(attendee);
      setUserArn(createAppUserAndChannelResponse.userArn);
      setChannelArn(createAppUserAndChannelResponse.channelArn);
      setChannelID(createAppUserAndChannelResponse.channelID);

      // Storage the Guide information in the cookies
      // Define your data
      const mainGuide = {
        meeting: meeting,
        attendee: attendee,
        userArn: createAppUserAndChannelResponse.userArn,
        channelArn: createAppUserAndChannelResponse.channelArn,
      };

      // Set the JSON cookie for 1 day
      JSONCookieUtils.setJSONCookie("Main-Guide", mainGuide, 1);
      console.log("Cookie set for 1 day!");

    } catch (error) {
      console.error('Error starting meeting:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createAppUserAndChannel = async (userID, userName) => {
    const userArn = await createAppInstanceUsers(userID, userName);
    console.log('Guide created:', userArn);
    const channelArn = await createChannel(userArn);
    const channelID = channelArn.split('/').pop();
    await addChannelMembership(channelArn, userArn);
    return {
      userArn,
      channelArn,
      channelID,
    };
  }

  // Function to transform the audio input device to Voice Focus Device/Echo Reduction
  const transformVoiceFocusDevice = async (meeting, attendee, logger) => {
    let transformer = null;
    let isVoiceFocusSupported = false;
    try {
      const spec = {
        name: 'ns_es', // use Voice Focus with Echo Reduction
      };
      const options = {
        preload: false,
        logger,
      };
      const config = await VoiceFocusDeviceTransformer.configure(spec, options);
      //logger.info('transformVoiceFocusDevice config', JSON.stringify(config));
      transformer = await VoiceFocusDeviceTransformer.create(spec, options, config, { Meeting: meeting }, { Attendee: attendee });
      console.log('transformVoiceFocusDevice transformer', transformer);
      setTransformVFD(transformer);
      isVoiceFocusSupported = transformer.isSupported();
      console.log('transformVoiceFocusDevice isVoiceFocusSupported', isVoiceFocusSupported);
    } catch (e) {
      // Will only occur due to invalid input or transient errors (e.g., network).
      console.error('Failed to create VoiceFocusDeviceTransformer:', e);
      isVoiceFocusSupported = false;
    }
    return isVoiceFocusSupported;
  }

  // Function to initialize the meeting session from the meeting that the host has created
  const initializeMeetingSession = useCallback(async (meeting, attendee) => {
    if (!meeting || !attendee) {
      console.error('Invalid meeting or attendee information');
      return;
    }

    const consoleLogger = new ConsoleLogger('ChimeMeetingLogs', LogLevel.INFO);

    const meetingSessionConfiguration = new MeetingSessionConfiguration(meeting, attendee);

    // const meetingSessionPOSTLogger = getPOSTLogger(meetingSessionConfiguration, 'SDK', `${Config.cloudWatchLogRestApiVTGRestApi}cloud-watch-logs`, LogLevel.INFO);
    // console.log('meetingSessionPOSTLogger', meetingSessionPOSTLogger);
    // const logger = new MultiLogger(
    //   consoleLogger,
    //   meetingSessionPOSTLogger,
    // );
    const logger = consoleLogger;
    console.log('logger', logger);
    setLogger(logger);
    // Check if the Voice Focus Device is supported on the client
    const isVoiceFocusSupported = await transformVoiceFocusDevice(meeting, attendee, logger);
    //logger.info('deviceController isVoiceFocusSupported' + isVoiceFocusSupported);
    // Initialize the meeting session
    const deviceController = new DefaultDeviceController(logger, { enableWebAudio: isVoiceFocusSupported });
    //logger.info('deviceController' + JSON.stringify(deviceController));
    const meetingSession = new DefaultMeetingSession(meetingSessionConfiguration, logger, deviceController);
    setMeetingSession(meetingSession);
    selectSpeaker(meetingSession);
    console.log('Main Speaker - initializeMeetingSession--> Start');
    metricReport(meetingSession);
    console.log('Main Speaker - initializeMeetingSession--> End');
    // Bind the audio element to the meeting session
    const audioElement = document.getElementById('audioElementMain');
    if (audioElement) {
      await meetingSession.audioVideo.bindAudioElement(audioElement);
    } else {
      console.error('Audio element not found');
    }

    const observer = {
      audioInputsChanged: freshAudioInputDeviceList => {
        // An array of MediaDeviceInfo objects
        freshAudioInputDeviceList.forEach(mediaDeviceInfo => {
          console.log(`Device ID xxx: ${mediaDeviceInfo.deviceId} Microphone: ${mediaDeviceInfo.label}`);
        });
      },

      audioOutputsChanged: freshAudioOutputDeviceList => {
        console.log('Audio outputs updated xxx: ', freshAudioOutputDeviceList);
      },

      videoInputsChanged: freshVideoInputDeviceList => {
        console.log('Video inputs updated xxx: ', freshVideoInputDeviceList);
      },

      audioInputMuteStateChanged: (device, muted) => {
        // console.log('Device xxx', device, muted ? 'is muted in hardware' : 'is not muted');
        console.log('Device yyy:', device);
        console.log('Status yyy:', muted ? 'is muted in hardware' : 'is not muted');
      },
    };

    meetingSession.audioVideo.addDeviceChangeObserver(observer);

    // Start audio video session
    meetingSession.audioVideo.start();
    console.log("enableLiveTranscription meetingId", meetingSession.configuration.meetingId);
    //const language = localStorage.getItem('i18nextLng');
    const languageCode = i18n.language === 'ja' ? "ja-JP" : "en-US";
    console.log("current languageCode", languageCode);
    const startMeetingTranscriptionResponse = await startMeetingTranscription(meetingSession.configuration.meetingId, languageCode);
    console.log("enableLiveTranscription startMeetingTranscriptionResponse", startMeetingTranscriptionResponse);
    // meetingSession.audioVideo.realtimeSendDataMessage(
    //   'TranscriptEvent',
    //   { message: "World" },
    //   30000,
    // );
  }, [i18n.language]);

  // Function to toggle microphone on/off
  const toggleMicrophone = async () => {
    if (meetingSession) {
      try {
        if (isMicOn) {
          // Mute the microphone
          const realtimeMuteLocalAudio = meetingSession.audioVideo.realtimeMuteLocalAudio();
          //logger.info('toggleMicrophone realtimeMuteLocalAudio ' + JSON.stringify(realtimeMuteLocalAudio));
          console.log('toggleMicrophone realtimeMuteLocalAudio', realtimeMuteLocalAudio);
          const stopAudioInput = await meetingSession.audioVideo.stopAudioInput(); // Stops the audio input device
          //logger.info('toggleMicrophone stopAudioInput ' + JSON.stringify(stopAudioInput));
          console.log('toggleMicrophone stopAudioInput', stopAudioInput);

        } else {
          // Start the audio input device
          // Create a new transform device if Voice Focus is supported
          const vfDevice = await transformVFD.createTransformDevice(selectedAudioInput);
          //logger.info('toggleMicrophone vfDevice ' + JSON.stringify(vfDevice));
          console.log('toggleMicrophone vfDevice', vfDevice);
          // Enable Echo Reduction on this client
          const observeMeetingAudio = await vfDevice.observeMeetingAudio(meetingSession.audioVideo);
          //logger.info('toggleMicrophone Echo Reduction ' + JSON.stringify(observeMeetingAudio));
          console.log('toggleMicrophone Echo Reduction', observeMeetingAudio);
          const deviceToUse = vfDevice || selectedAudioInput;
          //logger.info('toggleMicrophone deviceToUse ' + JSON.stringify(deviceToUse));
          console.log('toggleMicrophone deviceToUse', deviceToUse);
          const startAudioInput = await meetingSession.audioVideo.startAudioInput(deviceToUse);
          //logger.info('toggleMicrophone startAudioInput ' + JSON.stringify(startAudioInput));
          console.log('toggleMicrophone startAudioInput', startAudioInput);

          if (vfDevice) {
            // logger.info('Amazon Voice Focus enabled ');
            console.log('Amazon Voice Focus enabled ');
          }
          // Unmute the microphone
          const realtimeUnmuteLocalAudio = meetingSession.audioVideo.realtimeUnmuteLocalAudio();
          //logger.info('toggleMicrophone realtimeUnmuteLocalAudio ' + JSON.stringify(realtimeUnmuteLocalAudio));
          console.log('toggleMicrophone realtimeUnmuteLocalAudio', realtimeUnmuteLocalAudio);
        }

        setIsMicOn(!isMicOn); // Toggle mic status

      } catch (error) {
        //logger.error('toggleMicrophone error ' + error);
        console.error('toggleMicrophone error', error);
        if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
          // Handle permission denial
          alert(error);
          console.error("Permission denied by browser. Please allow access to continue.");
          //alert("Permission denied by browser. Please allow access to continue.");
        } else {
          // Handle other errors
          alert(error);
          console.error("Error accessing media devices:", error);
        }
      }
    }
  };

  // Async function to select audio output device
  const selectSpeaker = async (meetingSession) => {
    const audioOutputDevices = await meetingSession.audioVideo.listAudioOutputDevices();

    if (audioOutputDevices.length > 0) {
      await meetingSession.audioVideo.chooseAudioOutput(audioOutputDevices[0].deviceId);
    } else {
      console.log('No speaker devices found');
    }
  };

  // Function to get the list of audio input devices
  const getAudioInputDevices = useCallback(async () => {
    if (meetingSession) {
      const devices = await meetingSession.audioVideo.listAudioInputDevices(true);
      console.log('List Audio Input Devices:', devices);
      setAudioInputDevices(null);
      setAudioInputDevices(devices);
      setMicroChecking('microChecking');

      // Check if there are no devices or if any device label is empty
      if (devices.length === 0 || devices.some(device => !device.label.trim())) {
        //if (devices.length === 0) {
        console.log('No audio input devices found');
        // Display a message after 5 seconds
        setTimeout(() => {
          setMicroChecking(null);
          setNoMicoMsg('noMicroMsg');
        }, 5000);
      } else {
        // If devices are available, select the first device as the default
        setSelectedAudioInput(devices[0].deviceId);
        setNoMicoMsg(null);
      }
    }
  }, [meetingSession]);

  // Get meeting, attendee, and user information from the cookies
  useEffect(() => {
    const getMeetingAttendeeInfoFromCookies = async () => {
      const retrievedMainGuide = JSONCookieUtils.getJSONCookie("Main-Guide");
      console.log("Retrieved cookie:", retrievedMainGuide);
      if (!retrievedMainGuide) {
        setIsLoading(false);
        return;
      }
      const meeting = await checkAvailableMeeting(retrievedMainGuide.meeting.MeetingId, "Main-Guide");
      console.log('getMeetingResponse:', meeting);
      if (!meeting) return;
      console.log("Retrieved cookie:", retrievedMainGuide);
      initializeMeetingSession(retrievedMainGuide.meeting, retrievedMainGuide.attendee);
      setMetting(retrievedMainGuide.meeting);
      setAttendee(retrievedMainGuide.attendee);
      setUserArn(retrievedMainGuide.userArn);
      setUserId(retrievedMainGuide.userArn.split('/').pop());
      setChannelArn(retrievedMainGuide.channelArn);
      setChannelID(retrievedMainGuide.channelArn.split('/').pop());
      setIsLoading(false);
    }
    getMeetingAttendeeInfoFromCookies();
  }, [initializeMeetingSession]);

  useEffect(() => {
    getAudioInputDevices();
  }, [getAudioInputDevices]);


  useEffect(() => {

    if (selectedAudioInput) {
      console.log('Selected Audio Input:', selectedAudioInput);
    }
  }, [selectedAudioInput]);


  useEffect(() => {

    if (!meetingSession) {
      return;
    }
    const attendeeSet = new Set(); // List of sub-guides, listeners
    const callback = (presentAttendeeId, present, externalUserId) => {
      console.log(`Attendee ID: ${presentAttendeeId} Present: ${present} externalUserId: ${externalUserId}`);
      if (present) {
        attendeeSet.add(presentAttendeeId);
      } else {
        attendeeSet.delete(presentAttendeeId);
      }

      // Update the attendee count in the states
      setParticipantsCount(attendeeSet.size);
    };

    meetingSession.audioVideo.realtimeSubscribeToAttendeeIdPresence(callback);
    meetingSession.audioVideo.transcriptionController?.subscribeToTranscriptEvent(
      (transcriptEvent) => {
        console.log('enableLiveTranscription Received transcription:', transcriptEvent);
        setTranscriptions(transcriptEvent);
      },
    );
  }, [meetingSession]);

  useEffect(() => {
    if (transcripts) {
      if (transcripts.type === "started") {
        const transcriptionConfiguration = JSON.parse(transcripts.transcriptionConfiguration)
        console.log('transcriptionConfiguration:', transcriptionConfiguration);
        setSourceLanguageCode(transcriptionConfiguration.EngineTranscribeSettings.LanguageCode);
      }
      if (transcripts.results !== undefined) {
        if (!transcripts.results[0].isPartial) {
          // if (transcripts.results[0].alternatives[0].items[0].confidence > 0.5) {
          //     setLine(
          //       // `${transcripts.results[0].alternatives[0].items[0].attendee.externalUserId}: ${transcripts.results[0].alternatives[0].transcript}`,
          //       `${transcripts.results[0].alternatives[0].transcript}`,
          //     );
          // }
          setLine(
            // `${transcripts.results[0].alternatives[0].items[0].attendee.externalUserId}: ${transcripts.results[0].alternatives[0].transcript}`,
            `${transcripts.results[0].alternatives[0].transcript}`,
          );
        }
      }
    }
  }, [transcripts]);

  useEffect(() => {
    const translateTextSpeechData = async () => {
      console.log('translateTextSpeechData lines:', lines);
      console.log("current language", i18n.language);
      try {
        if (!lines) return;
        // Translate the text to speech
        //const sourceLanguageCode = 'en-US';
        console.log('translateTextSpeechData sourceLanguageCode:', sourceLanguageCode);
        const targetLanguageCode = i18n.language === 'ja' ? "ja-JP" : "en-US";
        if (sourceLanguageCode !== targetLanguageCode) {
          // console.log('current language targetLanguageCode:', targetLanguageCode);
          const translateTextSpeechResponse = await translateTextSpeech(lines, sourceLanguageCode, targetLanguageCode);
          console.log('translateTextSpeechData response:', translateTextSpeechResponse);
          setTranslatedText(translateTextSpeechResponse.translatedText);

          // Check if the response contains AudioStream data
          if (!translateTextSpeechResponse.speech.AudioStream || !translateTextSpeechResponse.speech.AudioStream.data) {
            throw new Error("Invalid AudioStream data");
          }

          // Convert the AudioStream buffer to a Blob
          const audioBlob = new Blob([Uint8Array.from(translateTextSpeechResponse.speech.AudioStream.data)], {
            type: translateTextSpeechResponse.speech.ContentType || "audio/mpeg", // Default to MP3 format
          });

          // Generate a Blob URL
          const audioUrl = URL.createObjectURL(audioBlob);

          // Bind the Blob URL to the <audio> element
          const audioElement = document.getElementById("audioElementListener");
          if (!audioElement) {
            throw new Error("Audio element not found");
          }

          audioElement.src = audioUrl; // Assign the Blob URL to the audio element
          audioElement.play();        // Play the audio
        }
      } catch (error) {
        console.error('Error translating text to speech:', error);
      }

    };
    translateTextSpeechData();

  }, [lines, sourceLanguageCode, i18n.language]);
  console.log('transcriptions', transcripts);
  console.log('lines', lines);

  // Function to handle the chat setting change
  const handleChatSettingChange = (e) => {
    setChatSetting(e.target.value);
  };

  // Function to handle the QR code generation selection
  const handleQRSelectionChange = (e) => {
    setSelectedQR(e.target.value);
  };

  return (
    <>
      <Participants count={participantsCount} />
      <div className="container">
        <audio id="audioElementMain" controls autoPlay className="audio-player" style={{ display: (meeting && attendee) ? 'block' : 'none' }} />
        {(!meeting && !attendee) ? (
          <>
            {(isLoading) ? (
              <div className="loading">
                <div className="spinner"></div>
                <p>{t('loading')}</p>
              </div>
            ) : (
              <button onClick={startLiveAduioSession}>{t('startLiveBtn')}</button>
            )}
          </>
        ) : (
          <>
            {meetingSession && (<AudioUploadBox meetingSession={meetingSession} logger={logger} />)}
            {(noMicroMsg) ? (
              <>
                {!microChecking ? (
                  <p style={{ color: "red" }}>{t('noMicroMsg')}</p>
                ) : (
                  <div className="loading">
                    <div className="spinner"></div>
                    {microChecking && <p>{t('microChecking')}</p>}
                  </div>
                )}
              </>
            ) : (
              <>
                <h3>{t('microSelectionLbl')}</h3>
                {(audioInputDevices && audioInputDevices.length > 0) && (
                  <select value={selectedAudioInput} onChange={(e) => setSelectedAudioInput(e.target.value)}>
                    {audioInputDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                )}
                <div className="controls">
                  <button onClick={toggleMicrophone} className="toggle-mic-button">
                    <FontAwesomeIcon icon={isMicOn ? faMicrophone : faMicrophoneSlash} size="2x" color={isMicOn ? "green" : "gray"} />
                  </button>
                </div>
              </>
            )}
            {/* <div>
              {transcriptions.map((t, idx) => (
                <p key={idx}>
                  <strong>{t.attendeeName}:</strong> {t.transcriptionText}
                </p>
              ))}
            </div> */}
            <h3>{t('chatSettingLbl')}</h3>
            <select value={chatSetting} onChange={handleChatSettingChange}>
              <option value="allChat">{t('chatSettingOptions.allChat')}</option>
              <option value="guideOnly">{t('chatSettingOptions.onlyGuideChat')}</option>
              <option value="nochat">{t('chatSettingOptions.noChat')}</option>
            </select>

            <h3>{t('generateQRCodeLbl')}</h3>
            <select value={selectedQR} onChange={handleQRSelectionChange}>
              <option value="subSpeaker">{t('generateQRCodeOptions.subGuide')}</option>
              <option value="listener">{t('generateQRCodeOptions.listener')}</option>
            </select>

            {meeting && channelArn && (
              <>
                {selectedQR === 'subSpeaker' ? (
                  <>
                    <QRCodeSVG value={`${Config.appSubSpeakerURL}?meetingId=${meeting.MeetingId}&channelId=${channelID}&hostId=${userId}&chatSetting=${chatSetting}`} size={256} level="H" />
                    <a target="_blank" rel="noopener noreferrer" style={{ color: 'green' }} href={`${Config.appSubSpeakerURL}?meetingId=${meeting.MeetingId}&channelId=${channelID}&hostId=${userId}&chatSetting=${chatSetting}`}>
                      {t('scanQRCodeTxt.subGuide')}
                    </a>
                  </>
                ) : (
                  <>
                    <QRCodeSVG value={`${Config.appViewerURL}?meetingId=${meeting.MeetingId}&channelId=${channelID}&hostId=${userId}&chatSetting=${chatSetting}`} size={256} level="H" />
                    <a target="_blank" rel="noopener noreferrer" style={{ color: 'green' }} href={`${Config.appViewerURL}?meetingId=${meeting.MeetingId}&channelId=${channelID}&hostId=${userId}&chatSetting=${chatSetting}`}>
                      {t('scanQRCodeTxt.listener')}
                    </a>
                  </>
                )}
              </>
            )}
            {lines && <div>{lines}</div>}
            {translatedText && <div>{translatedText}</div>}
            {chatSetting !== "nochat" && (
              <ChatMessage userArn={userArn} sessionId={Config.sessionId} channelArn={channelArn} />
            )}
          </>
        )}
      </div>
    </>
  );
}

export default StartLiveSession;