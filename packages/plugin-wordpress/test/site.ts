import { execFile as execFileCallback } from 'node:child_process';
import type { webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { importJwk } from '@fedify/fedify';

/**
 * Site fixtures for the plugin's tests: the files `@geekity/cms` reads at
 * boot, written straight so no test spends an argon2 hash or a quarter of a
 * second minting an RSA-4096 pair to prove something about the plugin.
 *
 * The key pairs are throwaway keys generated once by Fedify's
 * `generatewebcrypto.CryptoKeyPair` and `exportJwk`, the calls the site makes when it
 * mints a pair. They have never belonged to a site.
 */

type Algorithm = 'RSASSA-PKCS1-v1_5' | 'Ed25519';

const FIXTURES: readonly Readonly<Record<Algorithm, string>>[] = [
  {
    'RSASSA-PKCS1-v1_5':
      '{"key_ops":["sign"],"ext":true,"alg":"RS256","kty":"RSA","n":"lS_tO4FE5nrsa0FPuilCzx3x_JoNE4YrWA38V-WJrT8WDbJ9t0D1gQpE5ogx4txuLksUNR-yvqIVN6jUqwo4pgmk40TmkyCDEEJZ7ltnV_krSJsU25v3HMg3HokPrTh-RJoWJz_cEys2qxJlv-ZrLlKqfGI12whLTBVCUSe-66pJ4-cSDPJhyT2hTfmm72ksm8ofEPt4SanN5OGGmkUtu-7voOtacOozZlam-Q3k8clo3L1GIN7GihZz_IwYdu-vaI7OfDiHHJt7DmyGMsEpSvgHnVMWdOnrGezZkPYk59o8pw_19_edgrr4eFm7KdTeHdQOo1pmGZ2VCdhq4QEL1vVw2p8r3tk__yBQKI6YtksyO6gr9bevHKR7L_uI2fJ_KEyfTOIb2d9Yy5QfTIY9ynlw3cAqoJeAgYyaMXAwEEv0HAL-abVv6dN7laCUBGC4xZefYtPm_b5H1Ymw-mmiEY8vbKqBy4usPa2zxSg1BStdySjumZUga_rMaAmcProA39On3SP81Ws1xAAlo4cit_Xs6zf5pRj9r9ujz1_1vl7Q5JZuX_2J0DCWB9AqPbZKYKBBoiMT67KYqD5SrLKeYCejEAvV9jInbfW_UagWHR4fJmJVP3PnZ-IvVDuHEccaTqv0gyGajPDV5e8GEfzfQyWeOFWJrYeBN4MS35dhirs","e":"AQAB","d":"FkY-nGjTmbn2vJjWx4vLjtMAw19Y3nZk2FPWPmVmJfjKWScyP_8x6J9Y5DanhCC3TrAlBz2BWZcnpdTOU-9Fv_ymoswxxPvQtcfCV6VMC8WHIeMNvTBPN_voxuVd8tYBfEqpThjpye7kzawEhx9nF1Z-X-3l7psRav2tliJiDhuxxpZEiqxRz1MlV1gUBaDlaSlHdCinsA_rTuYhS71Sc8HcA2HAciV1oS0E5yCc80DIKFUWOGgqqolpreZY7MEipnDUAZYLDklkmSW477EJckkQEfxK2Q_n60oCvfMSVY-vCJ6IcgqFePRjjsyO9lLzCu8TdG5V2jM-AmdOpeObGbXIn-0y5Z4a4xdKS3FI3vr3pclnv9xOfMvdI5Z8yRbvOv2tLpMmoZ7VPXcldz3ziv4JnTNVGxIp2oJgi3VKFfFXRAammY-XetJRbveQMr5OVSerWHVsK_v6C4Hjl1o-2GWAXjaExrpwLJpfeZJ4f9bNdOf2LRzz45n_4O0KJXUbhvkrhptlDKnVD0g64sUTb-4kk11lqThMbiHbx4BZijnUmzDblUrv8GP1QDXSpoaUYu4dRCXFu6b25786P-Z2lvay6piIbvNAWf_eDZkkpvzOmFxGF49ku2eBS2kOVZwJcVJB-_SfNtK1fmpZq2l8YZMMIEQgXzv_d73AoJvkBYE","p":"y-3FXzKtsUB3WpCiBN-Udcke9tZPPeGflaV5lvvzU86HHhoJ_QRMlNafhonGyp8WwMsDlU6OZaLFnHNyK2_3PUj3n-gI7Be9A_sO8Os9ug3iw5YvFFRUch5O2hpPMrnGqQeQ7a6aMlDQtuLPYe-MKHNprj5ZzMrPexQgLhuhVr5v_b02oend0iBIn5YVc4z1sCuDaHnskvhSJd_mXdgqc8GeLU_Xpz_ZxIDnVZehX50tooULCHLxyFyQu8ZMzB_esXAYF429n1gfpZezmZrue7a4ep75TbwMmMfarja1VF3mmKTKwAaSFEFcehC6A58OCUfHaPbeOi6xuXj_5Onxew","q":"u0fb0-1K-oO5bJo5jYIvGizkd9dvexNW9MdWYt3BCB3Owlw7YKbtqVnmc2JWoSYsQ0sP6BW_sokHTmMibcJKGc7sPpm8ApY_cYu-C8ycTpOQLk9DDzigIwICEeeVRLdMsfe6EcZd3zuwgFm2fSU0zEEb-BVJaC_sPr7ti_C79w1FxjS_mZporOVrH2lo-qWPlJ9GverC9qIsOqxNXT0JRgFAWt3a3bngjZR0kCkP5G1gInABes4l0tS0iKTwFuHH_P3Mdd0625yzek0YmLedNhR4ML7wKpv9zUwVu6DRzazosrYkDNVSe1ojlY37WrYlewBbudPkgpjT-z9yYG5nwQ","dp":"op2EGhmrcADcLBfRWtl-5T3vtx3GKq5UN1ywzLk0m8vA6zwQYvaeqsFKjFopb0HVPv-kZ9cwrdNSiSN2EzVBjlk1PQomsz1quFXm4C52FnskLJsCB9AHVsjcUAdSyDxkMj2aUC4_P4g6JtxOSuZeeZMu3odRzICdWqP91UarLSTG4SuU-SAohnq_7qIbkP0CnezU6Obww3HI7_LPHF5X2961Z6SXbwL3gD7aOeKkCD6qOUKmPaKLMx69Oz8x1kRDrHKag42_e-Ult0J1MTPeoEBgc0d5vYcK9HnJ48o0ZoZKb8ZY9y9GJWjJeX0FGAYphzT5yrWxF-xMRH48cCotKQ","dq":"uJMTtoRxlwBnqP8-pZaecX-5E9uBhZ0D4G7tVrcS3bry4V8hLhqWtIdjtmg-1MfYa-H4pVV5_q1KRBkz_1Syz0i-UNwXDb2ifXeqL9rSWibYvKtlfgTi3l3GSHsjA_xbXDK4cXg9YBtl0rmYPzKCHKQ2uoPQOxywCw8E8xypQ80S7UtjYjFp5KyerPCohA7TuThY8igDSit-x7y06qWTFCl7kZKBeHEPPLoJP2MYxJp_WrFk4_F0GZuE6f8UmJihD1fbQHZu4a5IvMpq6WhdSsVVx0UHUhc3RjQsXyUaYUh-dlNIqFU921B1LZonFbnaqqUpwbVxyrxwf3iCc0OcgQ","qi":"vFi2gDeOtdYKCIfFa1fe6thgZbv228AFoYGmSt-HLmz7ZhxF566ZgF9PmJZzHJn_4AyMCKV0ADRfEa51B2IG4BDzbN64T_bjp17SGvokJRA3TUZvd_n2WVNvBMuSnHIWvo80Tw-az95bTKjTIJ2sPQHjSI9ksDwnyqxcqZaO5KV58f7i2n1PJvl-MSq07YDbIo2kdE3IgM3ly4q-xHP8nAxjIAcDIJ7gXWC-iG1nNxcuUD2tbR8gVg_c04bmAs2RNJ95AJm8fIukoOb4W-Ti3hTY5RM6rMnN3Dp3LxfTNBqytK-kKUDMpHK7gGtgL0OvaTG9fRXNa3o0VTri-FzQTw"}',
    Ed25519:
      '{"key_ops":["sign"],"ext":true,"alg":"Ed25519","crv":"Ed25519","d":"JUTUnhyH8CM5qLs2ALOJWE1gHibZYsDgDpjW9yoGxjc","x":"U_ZkoGb7WBeY_ExXAZqRYTQlzN29WYLREIarSJvqKL0","kty":"OKP"}',
  },
  {
    'RSASSA-PKCS1-v1_5':
      '{"key_ops":["sign"],"ext":true,"alg":"RS256","kty":"RSA","n":"3VzXWGilD3uzGEWpiT-fbx1uqh2I-KXQwZ778I6uJ9uLlxM7bUsKLBNRUG33IvWK267BcLjKStnGaM-icuHjgHDTf8ky2WizLNNvDkBiGlRcBRXT2sm8TQENKMXYcr9kfZTWdfGQzNR4HnMAfGvB_XFZVQ1O9PQ9HknF3WYIjodAWZ5aBTdTdn3rnKTvZ9P-E7Y6vArKg5uIOTmQkCX1r-IgtMHBkVn9zGFFUWCBRDesYXS6uY0wY6eYLdipn7GgBnkP8YA-o6yRL_aPj2KeWB_6YEfHbbmRGhifHwXG2kef4G4fXidT1y3QQDLMQ3bV0budw3keJolrPOvC54GiQfXk6JmXAif-WnMWpmGTK9jHMhQ6b0w-_1XLJ1fhVRQqyU_dJc6Bktc_bNeT15XiuQ38S3CSj3s04FZZbU062JD9mwZ7wJf9YN_-cL3wyIIkX2OmCSsYiYhJ8ehWkSXjjTMRMO5BasM3ejttBYfrLD87CysBKWnJsL7qlnS7UcLDf15fKEBfLLXOEc_pyvHqb48XvYN99annT9bmZaZHzX3kgcDxoCektMbHmL4Ik-n3IL4i6Vtm8xZ4PUnuG8JqNsEdHhXTL38GyiWvmkTwNARtFttqh1g9LknKGE72hBdzV6IF3146VSj0EZtPaBYkbs7dy-iBUIIZOv84ARPpHcE","e":"AQAB","d":"FYZrX0qvsEF-URAnE_RGl9q0EeE02j7ffZBs3b-2EiSgXoStfOt01gPb3pcO1syrH8EOyNwDOcOS7kqweHzcLzdpbY3ePrNWZve5XximIXrOBuWQOABxach-I9aXPVM8nZSNRSNEChLoCkfzBmZBExjET8evQ5UDY3BXh_edweRHft9tz_-JA2brtAv6xq0f0gFglTv0ZNdJKA1fsBCs4xk5RnJn1O88BXV49NiOQVirj792z8e5qpsXqm-c0O1ICxEXGov2q1pCtPgEDjSQArA7W8TnENWgVToLMQxSAZRA6OU0ciafWbd3_mIiKDZERPR6OxGKO8OVlLM1POdHZHXFeeixwQcQ5jWha5B7KaLl8QHxn3LGGg9-Yl-97r7pfMcZWYDynLNIMcSaHL8eL70PBW6J5aLmUGx-5cakKTQbjpcyrMbrVQ5Tr4Y2ieIX-QID7Dh_147FyV-7Sq59kX3bYxPOWPXXA0YtSBbtzgrlqDP99bUo8kX32WwXrk0FPl7bWffnc20YR-Zzmb42zvgczJ0uK45E_6Z1vNKo1stJQiVzgVrGTbrB-cEuW8qJ2eQgfVV3Gc-mSr8l8e-IxttrumUnMa4rs2znu1AYJn3QjByrMQaYW083MjCSzDyv2gKX1d_azwpT0tA5hZs7Iod-tAiJkmiwxFfDZe2jESU","p":"9v88_Qk6_Y669N4ccD7z6YaVn3r-YDGTcC6HyXxq4EUHLpRMA692RLUhMYJgnSW0kKNmCPSWhRk-x2nxmMxsKGi34yEqEuU79zIaxvmcPnoC_Wrq4bcCyDUIyyToJ2O78thL8TvFbuHi3ZfIBD09tfth3kWhBvkAmVgUzUqOZ5Yw4XPeibuG7HkJKhmNSqYDdqE63trIcH-Vs4d04foauXm9ubkZveilQ_tZeZVuBEJwLJg2D_Ju7gkCCTIII2Zb6D8XAiiZkxTC6rqHAOAK0Y-jZImiMXjt21YYEnjlpETB1XF2fEgEKaPs3iqTNnLmOGbmIuyVNdiHevD9ShZQ7Q","q":"5W5nxA40uCwlClzD6dkZfhZimCIdlNQ8DzYNRLAn3IlEVLft-e_NVtw-Dxmn2b0xrBX7SRgOKOVq1TtgIDZ4sKh2cfKoDP-kDeqkCovfR__r0grxmXguOAIvXMcwtfC6ll0mx-D4EG-yp7cfE4vT5QV9WLy1tEQNS_sdwtU-xgpKt8fk7I_j6LzTboxQVyJPRqisw2Wimz_mls6N7hriQSLP4-yo6KDqMxmtI5C0en5fCtKtrDCLuFpoLTGdHg63KEMOHx8eU-7UrkrIDXZNag75joHISX05G31aws2WRparomLhTshaFzCvFgJC14dxpRZgHPLieWNMFcmNjbUppQ","dp":"KhJBtiwLU0MrjygCGhBvBXj6JWcSyxnGrlYOpQA_SCIZ3hI-fGY3s-5SUBeQE1Rn1Dcw2xemR9eL_PWLxGYVijCEGfj9LKjFNQ7gxsGfnniz56x9g6Ljo2x9KfUIYiU3z16OWPHAaGmrdekzlZ1E1KmT-wNLMV_afUQmju1DIlvPyact4bICgmb_a59clLmAX4WI_Iqxl4_z1NeezhsG0E7vRSJFQzbMZ675h58vVSRn7QCkPMUjpgH8ycou3rDBuOZ-Kcz2k7n2lXreIgUHcriPsUFMUjbx9OlOQl87ZmabyZqA_xxZMSqN3y3LU3vwwOyuCIbZx4kxUnyX-DWi5Q","dq":"UiR9MkyDw4zKljMwUYFRBzusgRt1y9tQxYFsrrMDEopy1IIlyd55fifMcEuXNPXv2tTj6v-Z0jqRTVa8y8u02kr2XUWrtTux2OmxYbVCc9zE6abRaUkGAzeFDYqjfgB6TWt8fwOkzP2w0StXDQB7FPwqLKMjyy6yNAnsVd1TZEQ7DCGdbLT3vFQevu2ttgSqrXmmoS66UStHu6aoWh918iwskkYhE2jJcRI4Uwt0Eoc8L_vOAmA_Jfn4YnXo8uIB4YBghfP2P8a6jsxnY6p_fQFvh_4fX3BeCeGPpT9GFm_Lc5BDapmA59yeUxrsI45yudCRCMxNGXjbvNE0xQ-foQ","qi":"6D8BLx4EZxymgA9PPaSJRn2Ob18vVGiuLP3vepHaa3lReDsev3jN_O4g4VRLywebZoE8hqJxLGrbHeiYGBOzCM4qZlxlQ2OS3COmOkQjeOi6mtKMNh-J5sNnNioD6xgc6QTMiqb8Bkh_8ASPL1-gs7BlVkmnaS1Vms32oG9Hosf4GGnIGjsI0qRY0E97NEWEJK6eWmOk3xbGxr4DnmDu7uzZMsgAuFuGfXqJvsR57kA63GuA_K4ZZqee4oetBe58QRb7v4iR9Vkuljxzz5TPC_vgoC_vaZ2M8B8IWyY_IN9FvKj8YH91V7WYO-aHhRN7ZjEp-V4mPK_hZFg0qYzPgg"}',
    Ed25519:
      '{"key_ops":["sign"],"ext":true,"alg":"Ed25519","crv":"Ed25519","d":"gdhnNyrtTVOA1iz7Rfr7OjHciRmBpJbPpm5EDv9VVqk","x":"LDMkuc7ZOzv7TpryOZjGXzaSmsQJGd3Jf6Hol6fPtAo","kty":"OKP"}',
  },
  {
    'RSASSA-PKCS1-v1_5':
      '{"key_ops":["sign"],"ext":true,"alg":"RS256","kty":"RSA","n":"joiSJ8cqYMVOI0oBv-V_Njq-cFOkBsqdfQE277vmaf_daremqd_pEzoBSs-Pye_ZyhAKOnWAO2U2bSEF2N0qAgxInTCv1BCxmsCr0nY_a3EK72T-IW2oJoudPaHEDKwoybYjNINNLtRlJ5MrJl5YRf1W0KLzmdYbxMQ3a4WzKs87n_XttAdhnKy4vAhMKtiZTGaccFP2mDuw0gLn_45PuQzO8C3Xq3iR5xAGGDFcqQ9U9F6EojtrchnIQ91Yp5OZKaYvtVmEghiHZymm8VNESLsSyY2t20dq1n6e5cz0XKClOx9n8eajwn_ZihH1oPmOS6hURiVbfmHW9142jkXK7tJG7jiPaQNv4Ou9jwAP9aeQo3iXQ_V7dsCnDjTPk0nCHKb9PeX9-Nm9pYUwBi5UylmYzHL-cXUzQbkg9EP3YTpqsghT1oT4OP526fGAkryBLD4TDQveD6X5qGQfIqME4m-SLraRfmWKkuIdhLe2OMZyDsMYWwmNuarogHlVrLlTjvKS0XbxyZ26fK64dcbwA_6mdSa7MyRC1AZ46n8z3VwiHX16gLwwaSiFTLxWQIi0d77pxmFWECHOzmFElEZvhiVtNir-88RLPtA3LJHdfkfMmeLjlobPmxo0d1Ipi27CPktRqUFm5ZYLWp1l1pI4LsH73x51qlvxjCMgusTyUws","e":"AQAB","d":"G9ywjVwOeao4EwflfaiUDHrBPV3sQ3OaA5SYM5bMfM4Kb1EFIFHn0t1U4VXfqr7bGPe3uCO99F5dnEmHRhQ9oPbbvvaEeHTm8vRU4ihBT3Riidd5Ifm4lAhYrXKQy1VgB8Y17Y75KH1WZL0NA0wP_2Z9cP1ZlynWdclReBBDrMujwSom1DlZKHJPDlqk4P9EQD4SuJaBLtMERplQ1pDwHqFVVnfvn9JK2xszxcjobxfTKI3NaZUp9Lz7e-Cp8uAUYaLd0pp0H6ZB2bW3r5byUzFWg9XRNXspdFJ-JzfAUNcKVZtXC19lhaDOWoIWPOhrm3iFOM0WrIbdqa9eBMO53li9h_zwtH_DaVYg04hn4D_ZZ4i_wQemIdQ_cznhibHTQCLhEJvCTmZssT3neH_gdnuM-z-f3E3T3q5F_Bnyq-zQXxAwbt7hFkifC0N4ZEGCi8a8GMScJ3H_gcNLNE0GDCsydWvIlnKcu0IcSs3ggyKIqh3M_iSccrHMFqIBKwN3R-AP-DUl0ZrquYuP-LxEQq81XuxtlYM7exWbuJmvFzD5JeOFol7rNeMERh4ed1CsGyZGLnDiHPa7LzkdTjpblyJnY3JRuvPtv76y1FElkozrS2SLCEUi_RsNyfyEMb-Sh7vBLIcytsfUI0gUB-1pwTHolyinrX_2g7RHUQdFDKk","p":"xX3igzAD5tC__fTi9beWKhx2MOLPBPaPb_sWbVrPXwtwQgwtfYQx4RKrf5jIJ0siemNUtOt5s4l6rq2APqLc_zm9vGaojgMZz_bh5fLPECCO5m70IAVVL7i_v8i1xT3cqBibIj9vIWT53NbFu65aaFdDIiftzw55ohCdp0PBa5KH5pDncDnOPFbNDNVW0Ogny5OyKgI4Z97AoCUJ0LFSl8ApIGTKEO0ivqljm_jf_H2XjGs_TcPmzTRJPdbIO5BV_sU86dyebOuW_Zh3wxMMaMdupcGcf1msNi2cmbNRUfQoWEP4HHCb89FVUGA4PeLorGcAVrpAsR-gKJxnt5hOLw","q":"uMKOhtGbp9Lh1Q_WcHgh8szF5-bHKSrPulC8n5M6RJPS-oJUWm3xuFJCcppU4YK-l5TFFXoPhbYTpvF1Geq__Xp0HZOOLP3uVFdPCKnECPY4Z0pDtdrD-ICopBQXIqvXkvKPZeuVRFzz59nC6vBoloAOLqKdWuW8ZxtMqvKV8cRl1q0pXpUoJbGwlfeT0Nzbq6sl5_2AcdXKrjCVdU4mSsziqlkT6vTYqc0FUHjD0dN8GH1vLPpf_JOG6TA5HY80_KlqV9TBLOqF0rA7HOLKObSSadNobk6fQiDFc-WqewnZJ-4NsokaFW3k2C0VnjdJkWtdU5hcGynF4B6BewQN5Q","dp":"foKbnaoedbd3pbk_wmPuX9-Hnt1L_EPtsrBHt5maiaoMKWMfqO4L_cA1-DDo1rL8zSXgV10YwvfojQk7w-QUabKVZqDkjMRTvrLKFsGp_wy8PcUJwZFo9n8E5lguiMGOHmhUyGWWTPAgV2WFmSqhY4Gy0ah-YEtHg5fdRg7TUpO1Vu-wMmX1RRXdmMD5Mi3lgDWGxf5SH8fD4VKYrQVKgUdpkQS_pIQj47siwgF1iorxj9QL40cBDKbX3DNAZVeanu--i5j2K5PnT2BiJ6aGJoDK0ofqNnI9LR-e157VEwiy54fy4lUIsfGBE1Hv9UTsA7SftO7vDgfSUvGORz_bpQ","dq":"eejOOIEYDu1j270ehomOBPI-55xr72rzNAHP5A82VEeh32-djymaZD_K3mmc9kvZzJT6Ugh_M4AHiZEq7lXqJqvk8BsLpf5LgtU1LgcudadZYjYrZVQbGN5z6AflmBgBH1HzcpG2pSwcN_CE35aPvDZ0pSrhXzfVT8dAmE-GxscLV1JcyK7slaqgVOPOYfNI8wXz9hZb6UDjAnrGM2fEdnioWzR5ov-58ph4GDgHJW1BJbumXuw556PEUhtipHF4yfpTU-7rI-L_OBzWdGHkg5z1OuSmtJomFXEgOC_jhFnkMqet3A8A6gDgDg_5grMCVPSd2OngZH_0s8QNNYlgTQ","qi":"ZPdafUvmsNS0OW6uGSAWK50KjRbLhJabCJHFJVhxOWdU0O9jc3IlAjxyMAfM3dSnZJdygNqdrQHqc5ibqOboGB852-PHTr1OCP-HBmBW03XEJ-_cA7GVQavyn3cR7Uo_rNROWCwymrfPeVKl0eRygNrW0uLve6uVSNdBMyvbA2sCco11TZ2KNFUnDYK88yZJP5wad3Hc3tjGwtC15nFlgXp3yIqQbimBSAD5gmVTrtwjlfKrdbHIdycx6qLakFAeN0lik1EYtUL-wrfn9xgSBWVI0lcXFrDQZe9SaNRi7J7tJRIprCTvTCvtG3zmZa82ZRl9Xswmik3Y9nL7kk6mAA"}',
    Ed25519:
      '{"key_ops":["sign"],"ext":true,"alg":"Ed25519","crv":"Ed25519","d":"h8EGmJ7sSsQW6CjMz9v0OMf9XGB_ShpJRAD9LMf5UgU","x":"8OdhxhWNtH8RLJPr8I-p8p7nhi7p3QP2ijKJchVMDYE","kty":"OKP"}',
  },
];

/** One fixture pair, in the shape `generatewebcrypto.CryptoKeyPair` answers with. */
export async function testKeyPair(which = 0): Promise<webcrypto.CryptoKeyPair> {
  const jwk = JSON.parse(fixture(which)['RSASSA-PKCS1-v1_5']) as Record<string, unknown>;
  const publicHalf = Object.fromEntries(
    ['kty', 'alg', 'n', 'e'].map((member) => [member, jwk[member]]),
  );
  return {
    privateKey: await importJwk(jwk, 'private'),
    publicKey: await importJwk(publicHalf, 'public'),
  };
}

/** Put a user's key files where the site looks, so it reads rather than mints. */
export function seedActorKeys(dataDir: string, username: string, which = 0): void {
  const keys = path.join(dataDir, 'keys');
  mkdirSync(keys, { recursive: true, mode: 0o700 });
  for (const [algorithm, jwk] of Object.entries(fixture(which))) {
    writeFileSync(path.join(keys, `${username}.${algorithm.toLowerCase()}.jwk`), `${jwk}\n`, {
      mode: 0o600,
    });
  }
}

function fixture(which: number): Readonly<Record<Algorithm, string>> {
  const found = FIXTURES[which];
  if (found === undefined) throw new Error(`There is no test key fixture ${String(which)}.`);
  return found;
}

/** One account in `data/users.json`, with a hash nobody can sign in with. */
export interface TestUser {
  readonly username: string;
  readonly id?: number;
  readonly displayName?: string;
  readonly actorId?: string;
  readonly email?: string;
}

/** Write `data/users.json` straight. */
export function writeUsers(dataDir: string, users: readonly TestUser[]): void {
  mkdirSync(dataDir, { recursive: true });
  const written = users.map((user, index) => ({
    id: user.id ?? index + 1,
    username: user.username,
    ...(user.displayName === undefined ? {} : { profile: { displayName: user.displayName } }),
    ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
    ...(user.email === undefined ? {} : { email: user.email }),
    passwordHash: 'not-a-hash',
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  const nextId = written.reduce((top, user) => Math.max(top, user.id), 0) + 1;
  writeFileSync(
    path.join(dataDir, 'users.json'),
    `${JSON.stringify({ users: written, nextId }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/** Write `content/_data/site.json`, with the plugin enabled or not. */
export function writeSite(
  contentDir: string,
  options: { baseUrl: string; author: string; enabled: boolean },
): void {
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  writeFileSync(
    path.join(contentDir, '_data', 'site.json'),
    `${JSON.stringify(
      {
        title: 'Geekity',
        baseUrl: options.baseUrl,
        author: options.author,
        plugins: { '@geekity/plugin-wordpress': { enabled: options.enabled } },
      },
      null,
      2,
    )}\n`,
  );
}

/** What running the bin did. Non-zero exits are results here, not throws. */
export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

const execFile = promisify(execFileCallback);

/**
 * Run the installed `geekity` bin, the way a site's shim runs it, under tsx so
 * the site config can import this package's source.
 */
export async function runCli(args: readonly string[], cwd: string): Promise<CliRun> {
  const bin = fileURLToPath(import.meta.resolve('@geekity/cms/package.json')).replace(
    /package\.json$/,
    path.join('dist', 'cli.js'),
  );
  try {
    const { stdout, stderr } = await execFile(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), bin, ...args],
      { cwd },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** A site config that installs this package, from its source. */
export function writeConfigWithPlugin(directory: string): void {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  writeFileSync(
    path.join(directory, 'geekity.config.mjs'),
    `import wordpress from ${JSON.stringify(entry)};\n\nexport default { plugins: [wordpress] };\n`,
  );
}

/** A signed-in admin, as far as a screen test needs one: GETs with the session. */
export interface Admin {
  get(url: string): Promise<Response>;
}

/** Sign in through the login form, keeping the session cookie it sets. */
export async function signIn(
  app: { request(url: string, init?: RequestInit): Response | Promise<Response> },
  credentials: { username: string; password: string },
): Promise<Admin> {
  let cookie = '';
  const remember = (response: Response): Response => {
    const set = response.headers.get('set-cookie');
    if (set !== null) cookie = set.split(';')[0] ?? '';
    return response;
  };

  const form = await remember(await app.request('/admin/login')).text();
  const token = /name="csrf_token"\s+value="([^"]+)"/.exec(form)?.[1] ?? '';
  const response = remember(
    await app.request('/admin/login', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf_token: token, ...credentials }).toString(),
    }),
  );
  if (response.status !== 303) throw new Error(`Sign-in answered ${String(response.status)}.`);

  return { get: async (url) => remember(await app.request(url, { headers: { cookie } })) };
}
